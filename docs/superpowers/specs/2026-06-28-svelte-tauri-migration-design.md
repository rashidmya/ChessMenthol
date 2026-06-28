# Svelte + Tauri Migration (Drop Python) — Design Spec

**Date:** 2026-06-28
**Status:** Approved (brainstorming)
**Parent:** [`2026-06-24-chessmenthol-design.md`](2026-06-24-chessmenthol-design.md) (original architecture)
**Related memory:** `cross-platform-executables`, `milestone-roadmap`, `m5-frontend-redesign`

## 1. Overview

ChessMenthol today is a **Python backend + Svelte frontend** desktop app. A FastAPI/uvicorn
server runs an `Orchestrator` (board state, history, move classification), an `EngineManager`
(Stockfish as an external UCI subprocess), and a `vision` pipeline (screen capture via `mss`,
board detection via OpenCV, piece classification via an ONNX model). The Svelte UI talks to it
over a single WebSocket and is served as static files; the whole thing is packaged with
PyInstaller.

This spec replaces the Python backend with a **Tauri (Rust) + TypeScript** stack so the app
becomes effectively **Svelte-only, no Python**. The engine, chess logic, move classification, and
computer-vision pipeline all move into the web/WASM layer; the native (Rust) layer shrinks to a
thin **screen-capture** primitive — the one thing a web page cannot do.

**Motivation (decided during brainstorming):**

1. **Packaging / distribution pain.** PyInstaller bundling Python + numpy + OpenCV + ONNX +
   per-OS Stockfish binaries is large (~100 MB+) and fragile (hidden imports, dynamic libs,
   antivirus false positives). It also runs a localhost HTTP server *inside* a desktop app
   (`127.0.0.1:8765`), which can collide with ports and trip firewalls/AV.
2. **One language / simpler dev.** Logic is split across Python and TypeScript, bridged by a
   hand-rolled WebSocket command/state protocol, and chess rules are duplicated
   (`python-chess` backend + `chess.js` frontend) and can drift.

Both frictions are removed by consolidating on TypeScript with a tiny Rust shell.

## 2. Scope

**In scope:** reach **feature parity** with today's app on the new stack, then delete Python.

**Out of scope (explicitly):** no new features. The variation tree (Spec 2, approved but not yet
implemented) is **deferred**; its sequencing is revisited once the migrated core is solid. Region
select (M5b) is already shipped on `main` and is therefore part of the **parity surface**, not new
work. Of the original roadmap, only **M5c (packaging)** remains, and Phase 3 of this migration
absorbs it. This keeps the spec bounded to a like-for-like port.

### 2.1 Parity contract

The migration is "done" when the new app reproduces the current orchestrator's **command set**
and **state**:

- **Commands:** `set_fen`, `set_turn`, `make_move`, `undo`, `navigate`, `reset`,
  `set_analysis_enabled`, `play_best`, `set_engine`, `set_options`, `stop`, `capture_now`,
  `request_region_shot`, `set_region`, `clear_region`.
- **State fields:** `fen`, `sideToMove`, `engineId`, `analyzing`, `gameOver`, `eval`, `depth`,
  `lines`, `lastMove`, `visionStatus`, `detectedOrientation`, `lowConfidence`, `region`,
  `moveList`, `currentPly`, `analysisEnabled`, `movetime`.
- **Behaviors:** streaming multi-PV analysis with cancel-on-new-position; analysis off by
  default; the 10-way move classification (`brilliant, great, best, excellent, good, book,
  inaccuracy, mistake, blunder, miss`) with the played-vs-best "Last move" panel and clickable
  play-best; linear history + navigation + play-best; game-over detection; on-demand vision
  capture with region select, detected orientation, and low-confidence squares.

## 3. Target architecture

```
┌─ Tauri shell (Rust — thin) ──────────────────────────────┐
│  #[command] grab_full_desktop() -> RGBA pixels           │
│  #[command] list_monitors() -> [Monitor]                 │
│  (xcap crate; handles X11/Windows/macOS + Wayland portal)│
│  asset protocol sets COOP/COEP headers → enables SAB     │
└──────────────────────────────────────────────────────────┘
        │ pixels                          ▲ invoke()
        ▼                                 │
┌─ Renderer (Svelte 5 + TS) ───────────────────────────────┐
│  UI components (largely unchanged from today)            │
│  core/orchestrator.ts  ← replaces Python Orchestrator    │
│      owns board+history+cursor+settings as Svelte stores │
│  core/classify.ts · core/position.ts  (ported logic)     │
│  chess.js = single source of chess truth                 │
│     │                              │                      │
│     ▼ Web Worker                   ▼ Web Worker           │
│  engine-worker:                 vision-worker:           │
│   stockfish.wasm                  detect.ts (no OpenCV)  │
│   (threaded if SAB,               + onnxruntime-web      │
│    else single-thread)            (existing ONNX model)  │
│   UCI parse in TS                 + assemble (position)  │
└──────────────────────────────────────────────────────────┘
```

Key points:

- **The native layer does only screen capture.** No OpenCV, numpy, ONNX, or Stockfish in Rust —
  so there are no native CV/ML libraries to bundle per OS. This is what makes the Tauri binary
  tiny (~5–15 MB) and the cross-platform build trivial.
- **The WebSocket protocol disappears.** `serialize.py` + `frontend/src/lib/ws.ts` are replaced
  by direct calls into `core/orchestrator.ts`. The current "state frame" becomes a reactive
  Svelte store with the same field names, so UI components change minimally. A thin client module
  preserving `ws.ts`'s store shape (`state`, `lastError`, `connected`-equivalent) keeps the
  component diff small.
- **chess.js becomes the single source of truth** for legality, SAN, FEN, `isGameOver`,
  `isCheckmate`/`isStalemate`/`isDraw` (outcome), and `validateFen`-style checks — replacing
  every `python-chess` (`chess.Board`) use.

## 4. The port (Python → TypeScript/Rust)

| Today (Python) | → | New location |
|---|---|---|
| `server/orchestrator.py` | → | `src/core/orchestrator.ts` (the brain) |
| `server/session.py` (threaded streaming) | → | engine-worker streaming loop |
| `server/{app,launcher}.py`, `server/serialize.py` | → | **deleted** (Tauri shell + direct calls) |
| `engine/{manager,spec,types}.py` | → | engine-worker (UCI send/parse in TS) + preset config |
| `analysis/{classify,book}.py` | → | `src/core/classify.ts` (+ opening-book data) |
| `position.py` (assemble/orientation/side) | → | `src/core/position.ts` |
| `vision/detect.py` (Sobel + autocorrelation) | → | `src/vision/detect.ts` (plain TS array math) |
| `vision/pieces.py` (cv2.dnn ONNX) | → | `src/vision/pieces.ts` (onnxruntime-web) |
| `vision/tracker.py` | → | `src/vision/tracker.ts` |
| `vision/capture.py` (mss / Wayland CLI) | → | Rust `grab_*` command + thin TS wrapper |
| `chess.Board` everywhere | → | `chess.js` |

**Highest-risk ports (call out in the plan):**

1. **`detect.py` → `detect.ts`.** Grayscale + Sobel edge profiles, autocorrelation period
   finding, phase finding, checker-confidence, orientation hint, highlight squares. It is
   deterministic array math (no perspective warp), and it has golden tests
   (`tests/vision`, `tests/position_grids.py`) that port directly as fixtures to lock parity.
2. **`pieces.py` preprocessing parity.** `onnxruntime-web` must reproduce the exact
   `cv2.dnn.blobFromImages` preprocessing: scale `1/255`, BGR→RGB swap, resize to 32×32, class
   order `["bB","bK","bN","bP","bQ","bR","wB","wK","wN","wP","wQ","wR","xx"]`. The **ONNX model
   artifact is reused as-is** (it is already ONNX); only the inference runtime changes.

## 5. Engine: native Stockfish → `stockfish.wasm`

- Ship `stockfish.wasm` (the WASM Stockfish build, same lineage Lichess uses) loaded in a
  dedicated Web Worker; UCI commands are written and `info`/`bestmove` lines parsed in TS
  (replacing `python-chess`'s `chess.engine`).
- **Threading / SharedArrayBuffer:** runtime feature-detect `crossOriginIsolated &&
  typeof SharedArrayBuffer !== 'undefined'`. If present → use the **multi-threaded** wasm build;
  else → **single-threaded** fallback. The Tauri asset protocol sets `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: require-corp` so SAB is available on
  WebView2 (Windows) and WKWebView (macOS); the single-thread fallback covers older Linux
  WebKitGTK where threaded wasm is unreliable. No hard dependency on threading.
- **Presets** map cleanly: `stockfish` (Threads 2 / Hash 256) and `stockfish_lite`
  (Threads 1 / Hash 64) → wasm thread count + hash. `set_options` (depth, multipv, movetime,
  threads, hash) behaves as today.
- **Caveat (accepted):** wasm Stockfish is weaker per-second than a native binary. Acceptable for
  an assistant; strength stays user-configurable via depth/movetime.

## 6. Vision capture flow

1. `orchestrator.ts` handles `request_region_shot` → `invoke('grab_full_desktop')` → receives RGBA
   pixels (+ dimensions) → renders the fullscreen overlay for region selection (existing
   `RegionOverlay.svelte` / `region.ts`).
2. `set_region` stores the rectangle; `capture_now` → `invoke('grab_full_desktop')`, crop to the
   region in TS, hand the crop to the **vision worker** (`detect.ts` → `pieces.ts` →
   `position.ts`/`tracker.ts`) → `AssembledPosition` → apply placement via `set_fen` (placement
   compared, as today).
3. **Wayland:** `xcap` uses the desktop portal; the first capture may prompt for permission (a
   one-time OS prompt, far better than the browser's per-capture picker). X11/Windows/macOS
   capture directly.

When the app runs in a **plain browser** (no Tauri `invoke`), the capture commands are simply
unavailable and the vision UI is hidden/disabled — the app degrades to an analysis-only web tool.

## 7. Testing

- **Consolidate on Vitest** (one test runner). Keep all existing frontend Vitest suites.
- **Port the Python tests as the porting spec:** vision golden fixtures (`tests/vision`,
  `position_grids.py`), `classify` cases, UCI `info`-line parsing (against captured fixture
  strings, engine mocked), and orchestrator behaviors (history/navigate/play-best/game-over).
- Engine-marked integration: a small smoke test that loads `stockfish.wasm` and gets a `bestmove`
  for the start position (skipped if the wasm asset is absent), analogous to today's
  `engine`-marked tests.

## 8. Packaging (absorbs Milestone 5c)

- `tauri build` produces the cross-platform executables that satisfy the hard requirement:
  Windows `.msi`/`.exe`, macOS `.dmg`/`.app`, Linux `.AppImage`/`.deb`. This **replaces
  PyInstaller** and completes the M5c packaging milestone.
- Bundle `stockfish.wasm` (both single- and multi-thread variants) and `pieces.onnx` as app
  assets; `onnxruntime-web`'s wasm runtime ships alongside.
- A CI matrix (win/macos/linux) builds and uploads the three artifacts.

## 9. Phasing

Each phase leaves the app working end-to-end and becomes its own implementation plan.

1. **Phase 1 — core in the browser.** Port `engine` + `orchestrator` + `classify` + `position`
   chess logic to TS; drop the WebSocket; run `stockfish.wasm`. The app runs as a pure web
   analysis tool under `vite dev` (FEN/turn edit, play/undo/navigate/reset, streaming analysis,
   classification, play-best, game-over). **No vision yet.** Python engine/server code becomes
   unused.
2. **Phase 2 — Tauri shell + vision.** Add the Tauri project and the Rust `grab_*` commands; port
   `detect`/`pieces`/`tracker` to TS/WASM (`onnxruntime-web`); wire capture → region → vision →
   board. Reach vision parity inside the desktop window.
3. **Phase 3 — cut over.** Delete all Python (`chessmenthol/` package, `pyproject.toml` server
   bits, `scripts/fetch_engines.py`), finalize `tauri.conf.json` + CI packaging for the three
   OSes. M5c complete.

**Bonus from this order:** after Phase 1 the app already runs as a plain website (analysis-only);
the desktop build just adds vision. Graceful degradation comes for free.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Threaded wasm unreliable on Linux WebKitGTK | Feature-detect SAB; single-thread fallback. No hard dependency. |
| wasm Stockfish weaker than native | Accepted; strength is user-tunable (depth/movetime). |
| `detect.ts` not bit-parity with `detect.py` | Port the existing golden fixtures first; lock parity via tests before deleting Python. |
| `onnxruntime-web` preprocessing mismatch | Reproduce `blobFromImages` exactly (scale, RGB swap, 32×32, class order); validate against fixture crops. |
| Wayland capture permission UX | One-time portal prompt via `xcap`; documented; still better than per-capture browser picker. |
| Large rewrite of a mature, tested system | Phased delivery; each phase ships working; Python kept until each area reaches parity, then deleted in Phase 3. |
| In-flight roadmap (variation tree / region-select) | Out of scope here; resequenced after the core lands (per brainstorming decision). |

## 11. New dependencies

- **Rust/Tauri:** `tauri`, `xcap` (screen capture). Tiny shell.
- **JS:** `stockfish.wasm` (or equivalent wasm Stockfish package), `onnxruntime-web`.
- **Removed:** all Python runtime deps (`fastapi`, `uvicorn`, `mss`, `opencv-python-headless`,
  `numpy`, `python-chess`, `pywebview`) and PyInstaller packaging.
