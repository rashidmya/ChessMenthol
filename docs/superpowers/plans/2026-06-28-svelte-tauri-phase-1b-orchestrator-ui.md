# Svelte + Tauri Migration — Phase 1b: Orchestrator + Classify + UI Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python `Orchestrator` + WebSocket with an in-browser TypeScript core so ChessMenthol runs as a **pure-web analysis tool at feature parity** (FEN/turn edit, play/undo/navigate/reset, streaming Stockfish analysis, eval bar, multi-PV lines, move classification + "Last move" panel, play-best, game-over), driven by the Phase 1a engine module — no FastAPI, no `/ws`.

**Architecture:** A `core/orchestrator.ts` (port of `chessmenthol/server/orchestrator.py`) owns board + linear history + cursor + settings as Svelte stores, drives the Phase 1a `AnalysisSession`/`loadStockfish`, classifies played moves with `core/classify.ts` (port of `analysis/classify.py`), and serializes state via `core/serialize.ts` (port of `server/serialize.py`). `lib/ws.ts` is replaced by `lib/engineClient.ts` that exposes the **same `state`/`lastError` store shape and `send(command)` API**, so UI components barely change. Chess logic moves from `chess.js` to **`chessops`** (Lichess's chessground-native lib). Vision fields are emitted as inert defaults (Phase 2 wires them).

**Tech Stack:** TypeScript, Svelte 5, Vite, Vitest (already set up); `@lichess-org/chessground` (already); **`chessops`** (new, replaces `chess.js`); the Phase 1a `frontend/src/engine/` module. No Python, no Tauri yet (runs under `vite dev`).

**Spec:** `docs/superpowers/specs/2026-06-28-svelte-tauri-migration-design.md` (§2 parity contract, §3 architecture, §9 Phase 1). **Builds on:** Phase 1a (`docs/superpowers/plans/2026-06-28-svelte-tauri-phase-1a-engine-wasm.md`, engine module on this branch).

**Conventions:**
- Tests in `frontend/src/tests/`, run `cd frontend && npm run test`; one file `npx vitest run src/tests/<f>.test.ts`.
- **Faithful ports use the committed Python as the line-by-line spec.** Each port task names the source file; reproduce its behavior and port its pytest cases to Vitest (the parity gate). New/novel glue (the store, chessops integration, orchestrator↔session wiring) is given as complete code here.
- Each task group leaves the app working: groups i–iv are additive (app still runs on the Python backend); group v performs the atomic cutover; group vi verifies parity standalone.

---

## What we take from Lichess (and what we can't)

The migration leans on Lichess's open-source work rather than reinventing — but precisely, because parity and our unique features constrain it. **License:** `chessops` and `chessground` are **GPL-3.0**, compatible with this project's GPL-3.0-or-later (confirm SPDX in each `package.json`). Lichess's *lila* UI modules (`ceval`, `tree`, `analyse`) are **AGPL-3.0** and not published as standalone packages — *reference* their patterns, but copying code imposes AGPL on those files (combinable with GPLv3 per §13; network clause is moot for a desktop app; attribute if copied). Phase 1b uses only the GPL libraries + our own port, so it stays cleanly GPL-3.0.

| Need | Take from Lichess? |
|---|---|
| Board rendering | ✅ **chessground** — already used. |
| Chess logic (FEN/SAN/legal moves/outcome/attacks) | ✅ **chessops** (this phase) — `makeSanVariation` = `variation_san`, `chessgroundDests` = our `board.ts`, native to chessground, sets up the variation tree. |
| Engine in browser | ✅ done in Phase 1a (`stockfish` wasm). Lichess's `ceval`/`stockfish-web` were the reference. |
| Variation tree / PGN (Spec 2, deferred) | ✅ **big win** — lila's `tree` module + `@lichess-org/pgn-viewer` + chessops. Tee'd up by adopting chessops now. |
| Move classification (brilliant/great/…/miss) | ❌ chess.com-style; **Lichess has no equivalent** → port `analysis/classify.py` for parity. |
| Screen capture + board vision (Phase 2) | ❌ **not in Lichess at all** (Lichess reads its own game state) → fully our own. |

**Decision (recommended): adopt `chessops`, retire `chess.js`.** It is the Lichess-grade, chessground-native lib and covers every chess need across orchestrator/classify/serialize/board in one dependency. Cost: migrate the existing `chess.js` call sites (`lib/board.ts`, `moveToUci`, promotion helper, and their tests) — bounded, done in Task Group i. **Fallback** if you want minimal churn: keep `chess.js` and hand-roll numbered-SAN for `serialize.ts`; the rest of the plan is unaffected. Confirm this choice before starting.

---

## Parity contract (the definition of done)

Reproduce the current orchestrator's **commands** and **state fields** (from `server/orchestrator.py` `handle` + `_state_frame`; UI DTOs in `frontend/src/lib/types.ts`):

- **Commands:** `set_fen`, `set_turn`, `make_move`, `undo`, `navigate`, `reset`, `set_analysis_enabled`, `play_best`, `set_engine`, `set_options`, `stop`. (Vision commands `capture_now`/`request_region_shot`/`set_region`/`clear_region` are accepted but inert in 1b — Phase 2.)
- **State (`StateFrame`):** `fen, sideToMove, engineId, analyzing, gameOver, eval, depth, lines, lastMove, visionStatus, detectedOrientation, lowConfidence, region, moveList, currentPly, analysisEnabled, movetime`. In 1b, vision fields are constant defaults: `visionStatus:'idle'`, `detectedOrientation:null`, `lowConfidence:[]`, `region:null`.
- **Behaviors:** streaming multi-PV with cancel-on-new-position (Phase 1a `AnalysisSession`); analysis OFF by default; classify-on-play at depth ≥ 8 (`CLASSIFY_MIN_DEPTH`) producing the 10-way `MoveClass` + the played-vs-best "Last move" panel; play-best reuses the retained pre-move analysis; linear history + navigate + undo + reset; game-over detection freezes analysis.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/core/chess.ts` | Thin chessops helpers used everywhere: `posFromFen`, `fenOf`, `legalMovesUci`, `sanOf`, `variationSan`, `isGameOver`/`outcome`, `attackersOf`. One place that imports chessops. |
| `frontend/src/core/classify.ts` | Port of `analysis/classify.py`: `MoveClass`, `Thresholds`, `isSacrifice`, `classifyMove`. |
| `frontend/src/core/book.ts` | Port of `analysis/book.py` (`NoBook` + interface; opening book optional/empty for parity). |
| `frontend/src/core/serialize.ts` | Port of `server/serialize.py`: `analysisToDict`, `lineToDict`, `classificationToDict`, `lastMoveToDict`, `evalToDict` → the `StateFrame` DTOs. |
| `frontend/src/core/orchestrator.ts` | Port of `server/orchestrator.py`: the brain. Owns board/history/cursor/settings; drives `AnalysisSession`; emits `StateFrame` via a callback. |
| `frontend/src/lib/engineClient.ts` | Replaces `lib/ws.ts`. Instantiates the orchestrator + `loadStockfish`; exposes `state`/`lastError`/`errorSeq` stores + `send(cmd)`; same shape as `ws.ts`. |
| `frontend/src/lib/board.ts` (modify) | Swap `chess.js` → chessops (`chessgroundDests`, `turnColor`). |
| `frontend/vite.config.ts` (modify) | Remove the `/ws` + `/healthz` proxy (no backend). Keep COOP/COEP headers. |
| Tests | `core/*.test.ts` porting the pytest suites; update `lib`/component tests for the store swap. |
| Remove | `lib/ws.ts`; `chess.js` dependency (after Task Group i). |

---

## Task Group i — Adopt chessops, retire chess.js

Isolated and app-safe (board gating is client-side; the Python backend still runs). Establishes the one chess layer the rest of 1b builds on.

### Task i.1: Install chessops, build `core/chess.ts` helpers
**Files:** Create `frontend/src/core/chess.ts`, `frontend/src/tests/coreChess.test.ts`; modify `package.json`.
- [ ] Install: `cd frontend && npm install chessops` and confirm its `package.json` license is GPL-3.0.
- [ ] **TDD** `core/chess.ts` exposing (thin wrappers over chessops, so the rest of the code never imports chessops directly):
  - `posFromFen(fen: string): Chess` (`parseFen(fen).unwrap()` → `Chess.fromSetup(...).unwrap()`; throw on invalid — mirror `chess.Board(fen)` + `is_valid`).
  - `fenOf(pos): string` (`makeFen(pos.toSetup())`).
  - `legalDestsCg(pos)` → `chessgroundDests(pos)` from `chessops/compat` (for board.ts).
  - `legalMovesUci(pos): string[]`, `playUci(pos, uci): Chess` (clone+play; throw on illegal), `sanOf(pos, uci): string` (`makeSan`).
  - `variationSan(pos, uciList): string` — numbered SAN via `makeSanVariation` (= `variation_san`).
  - `outcomeOf(pos)` → `{ result: '1-0'|'0-1'|'1/2-1/2', reason: string } | null` mirroring `_outcome_dict` (checkmate/stalemate/insufficient material/… → reason strings matching the current UI).
  - `attackedBy(pos, square, color): boolean` (chessops `attacksTo`/attack helpers) for the sacrifice heuristic.
  - Test cases: round-trip FEN, legal move list for startpos (20), SAN of `e2e4`→`e4`, `variationSan` numbering (`1. e4 e5 2. Nf3`), checkmate/stalemate outcomes, an attacked-square case.

### Task i.2: Migrate `lib/board.ts` + helpers off chess.js
**Files:** modify `frontend/src/lib/board.ts`, any `moveToUci`/promotion helper; update `frontend/src/tests/{legalMoves,moveToUci,promotion,Board,BoardTurnColor}.test.ts`.
- [ ] Replace `legalDests(fen)`/`turnColor(fen)` with chessops via `core/chess.ts` (`legalDestsCg`, side-to-move from the position). Keep the exact exported signatures the components import so callers don't change.
- [ ] Run the affected tests; adjust expectations only where chess.js vs chessops differ cosmetically (dest map is equivalent). App still builds + runs on the Python backend.
- [ ] Remove `chess.js` from `package.json` once no imports remain (`grep -r "chess.js" src` is empty). Commit.

---

## Task Group ii — Port classification

### Task ii.1: `core/book.ts`
**Files:** Create `frontend/src/core/book.ts` (+ test). Port `analysis/book.py`: a `BookLookup` interface + `NoBook` (`containsMove → false`). Parity ships the empty book (the Python default is `NoBook`). Keep it pluggable.

### Task ii.2: `core/classify.ts`
**Files:** Create `frontend/src/core/classify.ts`, `frontend/src/tests/classify.test.ts`. **Port `chessmenthol/analysis/classify.py` exactly** (it is the spec):
- `MoveClass` (10 values), `Thresholds` (same defaults), `PIECE_VALUE`.
- `isSacrifice(posBefore, uci, t)` — use `core/chess.ts` `attackedBy` for `is_attacked_by`, and piece type at the destination before/after.
- `classifyMove(posBefore, uci, analysisBefore, analysisAfter, book?, thresholds?)` — replicate the ordered rules (book → brilliant → great → best → miss → cpl bands), using `Eval.pov` from the Phase 1a `engine/types.ts` (`evalPov`).
- [ ] **Port every pytest case** from `tests/analysis/` for `classify` as the parity gate (book move, brilliant sacrifice, great only-move, best, miss, each cpl band). Mirror the Python fixtures (construct `AnalysisInfo` with the engine types).

---

## Task Group iii — Port serialization

### Task iii.1: `core/serialize.ts`
**Files:** Create `frontend/src/core/serialize.ts`, `frontend/src/tests/serialize.test.ts`. **Port `server/serialize.py`** (DTO shapes must match `lib/types.ts` exactly):
- `evalToDict`, `lineToDict` (uses `variationSan` for `san`), `analysisToDict`, `classificationToDict`.
- `lastMoveToDict(c, posBefore, uci, beforeA, afterA, plies=3)` — played/best rows with white-POV `format_white` text (use `formatWhiteEval` from `engine/types.ts`) and truncated numbered continuations (`_continuation_san` → `variationSan(posAfter, pv[:plies])` + `' …'` when longer; best row drops the best move itself via `pv[1:]`).
- Skip `region_shot_to_dict` (Phase 2 / Tauri capture).
- [ ] Test against the shapes the UI consumes (compare to `LineDto`/`LastMoveDto`/`EvalDto`); port `tests/server/test_serialize*` cases.

---

## Task Group iv — Port the Orchestrator

### Task iv.1: `core/orchestrator.ts`
**Files:** Create `frontend/src/core/orchestrator.ts`, `frontend/src/tests/orchestrator.test.ts`. **Port `server/orchestrator.py`** — the largest, most intricate task. Map the runtime model:
- python-chess `chess.Board` → chessops `Chess` (via `core/chess.ts`); `move_stack`/history → the explicit `history: HistoryEntry[]` + `cursor` the Python already keeps; rebuild board by replaying `base_fen` + entries up to cursor.
- The threaded `AnalysisSession` + `_on_update` callback → the **Phase 1a `AnalysisSession`** (`onUpdate(info)`, `onDone()`), constructed with `loadStockfish`. The orchestrator subscribes; on each `onUpdate` it runs the **classify-on-play** flow (the `_pending` tuple: when `analysis.depth >= CLASSIFY_MIN_DEPTH(8)` and a move is pending, classify with retained `before_a`, store into history, emit). `_on_search_done` → flip `analyzing=false`.
- Commands → methods: `setFen/setTurn/makeMove/undo/navigate/reset/setAnalysisEnabled/playBest/setEngine/setOptions/stop`. Preserve subtle invariants noted in the Python (analysis OFF by default; `set_options` movetime ms↔s — pass `timeMs` straight to `AnalysisSession` now; `play_best` reuses `_pre_move_analysis`; game-over freezes analysis and emits null analysis; engine presets `stockfish`/`stockfish_lite` → `configure(threads,hash)` on the engine).
- Emits a `StateFrame` (via `core/serialize.ts`) through an injected `send(frame)` callback — identical shape to today's frames, with inert vision defaults.
- [ ] **Port the orchestrator pytest suite** (`tests/server/test_orchestrator.py`) to Vitest as the parity gate — make-move classification, navigate/undo, play-best replay, reset, options, game-over, analysis-enabled toggle. Use a fake engine (reuse the Phase 1a `FakeEngine` pattern) so these run without real Stockfish; add one real-engine smoke (shared instance) for the make-move→classify path.

---

## Task Group v — Cut over the UI (remove the WebSocket)

### Task v.1: `lib/engineClient.ts` replacing `lib/ws.ts`
**Files:** Create `frontend/src/lib/engineClient.ts`; update `frontend/src/App.svelte` import; update `frontend/src/tests/ws.test.ts` → `engineClient.test.ts`.
- [ ] Expose the SAME store surface as `ws.ts` (`state`, `lastError`, `errorSeq`, plus a no-op/`true` `connected`) and a `send(cmd: Command)` that dispatches to the orchestrator. Construct one orchestrator with `send = (frame) => state.set(frame)` and `onError = (m) => { lastError.set(m); errorSeq.update(n=>n+1) }`. Lazy-init the engine: `loadStockfish()` once on first analysis-enable (don't block startup; analysis is off by default). Keep `applyFrame` semantics if any component imports it.
- [ ] Point `App.svelte` (and anything importing from `ws.ts`) at `engineClient.ts`. The store shape is identical, so components are largely untouched — verify each consumer compiles.

### Task v.2: Remove the backend coupling
**Files:** modify `frontend/vite.config.ts`; delete `frontend/src/lib/ws.ts`.
- [ ] Delete `lib/ws.ts`; remove the `/ws` + `/healthz` proxy from `vite.config.ts` (keep COOP/COEP). `grep -r "/ws\|ws.ts" src` → only the new client remains.
- [ ] Vision UI (`SourceControls`/`RegionOverlay`/Capture/Region buttons) — gate off when no capture API is present (Phase 2 restores them). They may stay rendered-but-disabled, or hidden behind a `hasCapture` flag (`false` in 1b). Don't delete the components.

---

## Task Group vi — Verify parity standalone

### Task vi.1: Full suite + typecheck
- [ ] `cd frontend && npm run test` (all ports + updated component tests green) and `npx tsc -p tsconfig.app.json --noEmit`.

### Task vi.2: Manual parity check in the browser
- [ ] `npm run dev`, open the app (no Python server running). Verify against the parity contract: enter a FEN, toggle turn, play moves (classification badges + Last-move panel appear once analysis is on and depth ≥ 8), eval bar + multi-PV lines stream, play-best works, navigate/undo/reset, game-over freezes analysis. Confirm there are **no `/ws` network calls** (DevTools Network) and the engine loads (`stockfish.wasm`). Capture/Region controls are inert.
- [ ] Note: threaded wasm needs the COOP/COEP headers (present in `vite dev`); single-threaded fallback otherwise (Phase 1a `threadsAvailable`).

---

## Self-Review

**Spec coverage:** parity commands + state fields → Task Groups iv (orchestrator) + iii (serialize) + v (client); classification → ii; chess logic → i; cutover/no-WS → v; standalone run → vi. ✓
**Lichess leverage:** chessops adopted (i) with license check; classification correctly identified as not-in-Lichess and ported (ii); variation-tree leverage tee'd up (chessops) for Spec 2; vision correctly identified as not-in-Lichess (Phase 2). ✓
**Placeholders:** faithful-port tasks name the committed Python source as the spec and require porting its pytest cases — the source is the complete content; novel glue (engineClient store, core/chess.ts, orchestrator↔session wiring) is specified inline. ✓
**Decisions flagged for confirmation:** (1) chessops vs keep-chess.js (recommended: chessops). (2) lazy engine init on first analysis-enable. (3) vision controls inert-vs-hidden in 1b.
**Risk:** the orchestrator port (iv) is the intricate piece — its classify-on-play `_pending` flow and play-best analysis reuse must match the Python; the ported pytest suite is the gate. Keep `core/orchestrator.ts` focused; if it grows unwieldy, split state-model (history/cursor/board) from the analysis-driving logic.
