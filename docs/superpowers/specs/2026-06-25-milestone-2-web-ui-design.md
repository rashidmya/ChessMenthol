# Milestone 2 — Web UI Skeleton + Backend Bridge Design Spec

**Date:** 2026-06-25
**Status:** Approved for planning
**Builds on:** Milestone 1 (engine + chess core, on `main`)

## 1. Overview

Milestone 2 turns the M1 engine core into a **usable manual chess analysis board**: a Svelte web UI that shows a rendered board, a live evaluation bar, streaming multi-PV engine lines, and a last-move classification badge, all driven over a WebSocket by a FastAPI backend that wraps the M1 `EngineManager` + `classify_move`. No computer vision yet — you drive it by hand (enter a FEN, set side to move, drag pieces to explore). This is the foundation the M3 capture loop later plugs into.

## 2. Goals

- **Live streaming analysis:** eval + multi-PV lines update as the engine searches deeper (depth 1→N), and a new position cancels the in-flight search.
- **Manual analysis board:** enter/adjust a position (FEN + White/Black turn toggle + flip), drag pieces to explore variations (engine follows the line).
- **Last-move classification badge:** when a move is played on the board, classify it (brilliant/great/best/…/blunder/miss) via M1's `classify_move`.
- **Engine controls:** switch Stockfish ↔ Stockfish Lite; set depth/time, number of lines (multi-PV), threads, hash.
- **Browser-first + thin desktop launcher:** FastAPI serves the built UI + WebSocket on `127.0.0.1`; a `chessmenthol-app` entry point opens a pywebview window pointing at it.

## 3. Non-Goals (deferred)

- Screen capture & board detection (M3); piece classifier (M4).
- Full piece-palette edit mode, auto-tracking polish, packaging into executables (M5).
- Multi-client / networked use — exactly one local client is assumed.
- The Source/Capture controls render but are **disabled** with a "coming soon" state.

## 4. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Analysis delivery | Live streaming (incremental engine updates over WebSocket; cancel on new position) |
| Frontend stack | Vite + Svelte + TypeScript + chessground |
| Desktop shell | Browser-first (FastAPI serves UI + WebSocket on localhost) + thin pywebview launcher |
| Last-move classification | Included in M2 (reuses M1 `classify_move`) |
| Source/Capture controls | Rendered but disabled until M3 |

## 5. Architecture

```
            ┌───────────────────── pywebview window (chessmenthol-app) ─────────────────────┐
            │  Svelte UI: chessground board, eval bar, multi-PV lines, badge, controls       │
            └───────────────▲───────────────────────────────────────┬──────────────────────┘
                            │ state frames (WS)                      │ command frames (WS)
            ┌───────────────┴───────────────────────────────────────▼──────────────────────┐
            │ FastAPI app (chessmenthol/server/app.py): GET / (static assets) + /ws          │
            └───────────────▲───────────────────────────────────────┬──────────────────────┘
                            │ serialized state                       │ commands
            ┌───────────────┴───────────────────────────────────────▼──────────────────────┐
            │ Orchestrator: owns EngineManager + working Board + AnalysisSession             │
            │   command → mutate board/settings → restart session → stream updates → send    │
            └───────────────────────────────────────────────────────────────────────────────┘
                            │ AnalysisInfo snapshots (background thread, throttled)
            ┌───────────────┴───────────────────────────────────────────────────────────────┐
            │ EngineManager.stream_analysis (M1 engine layer, extended)                       │
            └───────────────────────────────────────────────────────────────────────────────┘
```

## 6. Components

### 6.1 `engine/manager.py` (extend M1) — streaming primitive
- **Job:** provide incremental, cancellable analysis in addition to the existing one-shot `analyze`.
- **Interface:** `stream_analysis(board, *, multipv=None, depth=None, time=None) -> AnalysisStream`.
  `AnalysisStream` wraps python-chess's `engine.analysis()` result: iterating it yields `AnalysisInfo` **snapshots** (rebuilt from the handle's per-line latest info as updates arrive); `.stop()` cancels the search; usable as a context manager. AnalysisInfo construction stays in the engine layer (no server coupling).
- **Depends on:** `python-chess` (`SimpleEngine.analysis`), M1 `AnalysisInfo`.

### 6.2 `server/serialize.py` — DTO layer (the serializer the M1 review recommended)
- **Job:** convert M1 dataclasses to JSON-friendly dicts with both UCI and SAN.
- **Interface:** `analysis_to_dict(analysis, board) -> dict`, `eval_to_dict(eval) -> dict`, `classification_to_dict(c) -> dict`. Lines include `multipv`, `scoreText` (`Eval.format_white`), `pv` (UCI strings), and `san` (via `board.variation_san`). Pure functions.
- **Depends on:** `python-chess`, M1 `types`/`classify`.

### 6.3 `server/orchestrator.py` — session state machine
- **Job:** own the `EngineManager`, the working `chess.Board`, current settings, and the active `AnalysisSession`; apply commands; (re)start streaming; emit serialized state via an injected `send(dict)` callback.
- **Interface:** `set_fen(fen)`, `set_turn(white_bool)`, `make_move(uci)`, `undo()`, `set_engine(id)`, `set_options(depth, multipv, threads, hash)`, `stop()`, `close()`. Each validates input, mutates state, restarts analysis, and (for `make_move`) computes a last-move `Classification`. Invalid input → emits an `error` frame, no state change.
- **`AnalysisSession`** (`server/session.py`, its own focused file): runs `stream_analysis` on **one background thread**, throttles updates (~5–10/sec), calls `send` with serialized state, and is `stop()`-able/restartable.
- **Depends on:** 6.1, 6.2, M1 `EngineManager`/`classify_move`.

### 6.4 `server/app.py` — FastAPI + WebSocket
- **Job:** `create_app()` factory; `GET /` + static assets from the built frontend dir; `/ws` endpoint that wires a WebSocket to an `Orchestrator` (the `send` callback enqueues frames onto the socket via `run_coroutine_threadsafe`); on disconnect, `orchestrator.close()`.
- **Depends on:** `fastapi`, `uvicorn`, 6.3.

### 6.5 `server/launcher.py` + entry points
- **Job:** `chessmenthol-server` runs uvicorn; `chessmenthol-app` starts uvicorn on a background thread then opens a `pywebview` window at the localhost URL.
- **Depends on:** `uvicorn`, `pywebview`.

### 6.6 `frontend/` — Vite + Svelte + TS
- **Job:** the UI. `lib/ws.ts` (WebSocket client + Svelte stores for state); `Board.svelte` (chessground bound to working FEN, emits `make_move` on drag); `EvalBar.svelte`, `Lines.svelte`, `Badge.svelte`, `Controls.svelte` (sectioned: Position / Display / Engine active, Source disabled). Build output → `frontend/dist`, served by FastAPI.
- **Depends on:** `svelte`, `chessground`, `vite`, `typescript`.

## 7. WebSocket protocol

- **Client → server** (`{type, …}`): `set_fen{fen}`, `set_turn{white}`, `make_move{uci}`, `undo`, `set_engine{id}`, `set_options{depth?,multipv?,threads?,hash?}`, `stop`. (Flip is client-side only — it just re-orients chessground.)
- **Server → client** state frame: `{type:"state", fen, sideToMove, eval:{cp,mate,text}, lines:[{multipv,scoreText,pv:[uci],san}], depth, engineId, analyzing, lastMove?:{uci, classification:{label,cpl,isBest}}}`, pushed (throttled) on each incremental engine update.
- **Server → client** error frame: `{type:"error", message}`.

## 8. Data flow & threading

Single local client → one global `Orchestrator`. The async `/ws` handler receives command frames, calls the matching `Orchestrator` method (which mutates the board/settings and restarts the `AnalysisSession`), and registers a `send` callback that pushes frames to the socket. The `AnalysisSession` runs Stockfish on one background thread; each `AnalysisInfo` snapshot is serialized and delivered to `send` via `run_coroutine_threadsafe`, throttled so the UI doesn't thrash. A new position/setting `stop()`s the in-flight search before starting the next.

## 9. Error handling

- Invalid FEN / illegal move → `error` frame, keep last good state (socket never crashes).
- Engine crash → M1 `EngineManager` auto-restart; session restarts the search.
- WebSocket disconnect → `stop()` + release the engine session.
- Unknown/malformed command → ignored with an `error` frame.

## 10. Packaging readiness (cross-platform executables — a hard project requirement)

ChessMenthol must ship as standalone executables for **Windows, Linux, and macOS** (built in M5). M2 keeps that on track:
- **pywebview** uses the OS-native webview (WebView2 / WKWebView / WebKitGTK) — no Chromium bundled, small binaries.
- **Svelte/Vite** compiles to **static assets** (HTML/CSS/JS); the Node/Vite toolchain is **build-time only** and is not bundled into the executable. The built `frontend/dist` is packaged as data files served by FastAPI.
- **FastAPI + uvicorn + python-chess** are PyInstaller-friendly (uvicorn needs its standard hidden-import hooks).
- Entry point for the packaged app is `chessmenthol-app` (server thread + pywebview window).
- **Constraint for this milestone:** no choice may block PyInstaller bundling. M5 adds the PyInstaller spec(s) + CI building all three OSes; M2 must produce a frontend build step whose output is bundleable, and a single launcher entry point.

## 11. Testing

- **Backend hermetic:** `serialize.py` (AnalysisInfo→dict incl. UCI+SAN, eval text, mate, classification); `Orchestrator` command handlers using a **fake stream source** (set_fen/make_move/set_engine mutate state, illegal input → error frame, last-move classification computed); WebSocket flow via FastAPI `TestClient` with the fake source.
- **Backend engine-marked:** `stream_analysis` yields ≥1 snapshot with non-decreasing depth then stops cleanly; a `TestClient` `/ws` test driving a short real search end to end.
- **Frontend (Vitest):** `EvalBar` renders from an eval; `Lines` from lines; `Board` emits `make_move` on drag; the store applies a server state frame; `ws.ts` against a mock socket.
- Preserves the M1 hermetic vs `@pytest.mark.engine` split.

## 12. Build order (tasks)

1. **Engine streaming primitive** — `EngineManager.stream_analysis` + `AnalysisStream` (engine-marked TDD).
2. **Serialization DTOs** — `serialize.py` (hermetic TDD).
3. **Orchestrator + AnalysisSession** — command handlers + threaded streaming with a fake source (hermetic) then engine-marked (TDD).
4. **FastAPI app + `/ws`** — `create_app`, static serving, WebSocket wiring; `TestClient` tests.
5. **Launcher + entry points** — `chessmenthol-server`, `chessmenthol-app` (pywebview).
6. **Frontend scaffold** — Vite+Svelte+TS project, chessground `Board` from FEN, `ws.ts` store; Vitest setup.
7. **Frontend UI + wiring** — eval bar, multi-PV lines, last-move badge, sectioned controls; end-to-end manual verification (drag a move, watch eval stream live).

## 13. Risks & open questions

- **Thread↔async bridge:** pushing background-thread updates onto the async WebSocket via `run_coroutine_threadsafe` needs care (capture the running loop at connect time). Mitigated by the fake-source tests for the handler and one real end-to-end test.
- **Update throttling:** raw engine info can arrive very fast; the session must coalesce to ~5–10 frames/sec to keep the UI smooth. Tunable.
- **chessground integration in Svelte** (it's a vanilla TS lib) — wrap it in a Svelte action/component; pin the version.
- **PyInstaller + uvicorn/pywebview hidden imports** — a known, solved problem; validated in M5, but M2's launcher should avoid dynamic import tricks that complicate it.
- **Multi-PV snapshot from python-chess** — building `AnalysisInfo` from the analysis handle's per-line latest info; verify line ordering/completeness with an engine-marked test.
