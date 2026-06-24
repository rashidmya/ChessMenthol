# ChessMenthol — Design Spec

**Date:** 2026-06-24
**Status:** Approved for planning

## 1. Overview

ChessMenthol is a cross-platform (Windows, Linux, macOS) **desktop** application that watches a
region of the screen, uses computer vision to detect a chess board and its pieces on **any online
chess site**, and provides live engine analysis: an evaluation bar, move-hint arrows, multi-line
(multi-PV) engine output, and per-move quality classification (brilliant, great, best, good,
inaccuracy, mistake, blunder, missed, book).

It is inspired by the ChessMint and BetterMint browser extensions, but is a standalone native app
that reads the board from **screenshots + computer vision** rather than from a website's DOM — which
is what makes it work across any site and as a desktop program.

The user can also interact with the board directly inside the app: drag pieces to explore
variations (the engine follows the line) and switch to an edit mode to correct any piece the vision
misdetects.

## 2. Goals

- Capture a chosen monitor or drag-selected screen region and **auto-detect** the board within it.
- Work on **any online chess site** (Chess.com, Lichess, and arbitrary sites/viewers), not a fixed list.
- **Hybrid tracking:** continuously poll and auto-update the position, with a hotkey to force a
  re-capture and a toggle to pause auto-tracking.
- Render the **detected position on a clean board** (no screenshot shown in the UI), with a thin
  evaluation bar and an analysis panel.
- **Engine hints** (toggleable): best-move arrows, multi-PV lines, evaluation.
- **Move classification** for both the move just played on the live board (detected by diffing
  consecutive positions) and for candidate moves / moves the user tries on the board.
- **Manual board interaction:** explore variations *and* edit/correct the detected position.
- **Auto-detect with manual override** for the things a screenshot cannot show: board orientation
  and side-to-move (explicit White/Black toggle), with conservative castling/en-passant inference.
- **Engine choice:** two bundled engines — **Stockfish** (full) and **Stockfish Lite** — with exactly
  one active at a time, switchable from the first release. The engine binaries are **downloaded and
  bundled with the app** (fetched from the official Stockfish release at build/setup time, not
  depended on from the user's system).

## 3. Non-Goals (explicitly out of scope)

- **No physical-board / webcam detection.** Screen capture only.
- **No auto-move / auto-play** into the target site. ChessMenthol is an analysis/hint tool; it does
  not play moves on the user's behalf on another application.
- **No detection-evasion / anti-cheat-bypass features.**
- **No custom/third-party UCI engine loading** in v1. Only the two bundled Stockfish builds. (May be
  revisited later; the engine layer is built generically over UCI so this is a small future add.)
- **No cloud/online features, accounts, or telemetry.** Fully local.
- **No exact reproduction of Chess.com's proprietary classification algorithm** — we approximate it
  with tunable heuristics.

## 4. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Detection scope | Any online chess site (general detector, not a fixed theme list) |
| Capture model | Hybrid: continuous auto-tracking + manual capture hotkey + pause toggle |
| Tech stack | Python core (CV + engine + chess logic) + web UI in a native webview |
| What is classified | Both: the live played move (via position diffing) and candidate/tried moves |
| Game state | Auto-detect orientation + side-to-move, with manual override (flip + White/Black toggle) |
| Board interaction | Both: explore variations *and* edit-to-correct the detected position |
| UI layout | Single clean rendered board (no screenshot shown); eval bar; fixed ~300px sidebar panel; board is the dominant element and scales with the window |
| Controls | Grouped into sections: Source · Display · Position · Engine |
| Engines | Two bundled (Stockfish, Stockfish Lite), single active at a time, from v1 |

UI wireframes from the brainstorming session are saved under
`.superpowers/brainstorm/` (layout-v7 is the final reference).

## 5. Architecture

Three layers in a single packaged application:

1. **Frontend (web UI)** — TypeScript + HTML/CSS, using `chessground` (Lichess's board component) for
   the board and custom components for the eval bar, multi-PV list, move list, and sectioned controls.
   Rendered inside a **pywebview** native window (uses the OS-native webview: WebView2 on Windows,
   WKWebView on macOS, WebKitGTK on Linux — no Chromium bundled).
2. **Backend bridge** — a local **FastAPI** app on `127.0.0.1` with a **WebSocket** that streams
   analysis/state to the UI and receives commands. FastAPI also serves the static frontend assets.
3. **Core Python services** — capture, board detection, piece classification, position assembly,
   engine management, and move classification. Orchestrated by a capture→analysis loop running on a
   background thread.

```
              ┌────────────────────────── pywebview window ──────────────────────────┐
              │  Web UI (chessground board, eval bar, panel, sectioned controls)      │
              └───────────────▲───────────────────────────────┬──────────────────────┘
                              │ state (WebSocket)              │ commands (WebSocket)
              ┌───────────────┴───────────────────────────────▼──────────────────────┐
              │                         FastAPI + WebSocket (127.0.0.1)                │
              └───────────────▲───────────────────────────────┬──────────────────────┘
                              │ AppState updates               │ command handlers
         ┌────────────────────┴────────────────────────────────────────────────────┐
         │ Orchestration loop (background thread)                                    │
         │   capture → change-detect → board_detect → piece_classify → position →    │
         │   (if changed) engine.analyze + classify_move → push AppState             │
         └───────────────────────────────────────────────────────────────────────────┘
```

## 6. Modules

Each module is independently testable: a clear job, a small interface, explicit dependencies.

### 6.1 `capture`
- **Job:** grab frames from a monitor or sub-region; skip frames that haven't changed.
- **Interface:** `list_monitors()`, `set_region(region|None)`, `grab() -> Frame`,
  `grab_if_changed() -> Frame|None` (perceptual-hash / downsampled diff to avoid redundant work).
- **Depends on:** `mss`, `numpy`.

### 6.2 `board_detect`
- **Job:** find the 8×8 board in a frame **geometrically** (the grid geometry is universal even when
  colours/themes differ), and slice it into 64 square images.
- **Interface:** `detect(frame) -> BoardLocation|None` (board quad/bbox, per-square cell rects,
  orientation hint from coordinate labels, last-move-highlight squares); `crop_squares(frame,
  location) -> list[SquareImage]` in canonical a1..h8 order.
- **Approach:** edge/line detection + largest repeating two-colour checker region; refine to a square
  grid. Highlight detection finds the two most-tinted squares to hint the last move.
- **Depends on:** `opencv-python`, `numpy`.

### 6.3 `piece_classify`
- **Job:** classify each square as empty or {white,black} × {P,N,B,R,Q,K}, with a confidence score.
- **Interface:** `classify(list[SquareImage]) -> list[SquareLabel]` where `SquareLabel = (piece|None,
  confidence)`.
- **Approach:** a small CNN (MobileNet-class) exported to **ONNX**, trained primarily on **synthetic
  data** — many freely-available piece sets rendered onto many board themes at many sizes, with
  augmentation (scaling, blur, JPEG artifacts, last-move highlight overlays). This is the mechanism
  that generalizes to unknown sites. Optionally, a fast per-theme template-matching path for known
  Chess.com/Lichess themes can short-circuit the CNN for extra accuracy.
- **Depends on:** `onnxruntime`, `numpy`. (Training pipeline is a separate dev-time tool, not shipped.)

### 6.4 `position`
- **Job:** turn per-square labels + orientation + side-to-move into a **legal** `python-chess` board;
  infer the move played between two consecutive positions; flag low-confidence squares.
- **Interface:** `assemble(labels, orientation, side_to_move, prev_board) -> AssembledPosition`
  (FEN, `is_legal`, low-confidence square list, inferred `Move|None`); `infer_move(prev_board,
  new_placement) -> Move|None`.
- **Heuristics:** orientation from coordinate labels / piece layout; side-to-move from last-move
  highlight + alternation while tracking; castling rights inferred from king/rook home squares;
  en-passant only when the diff reveals a just-played double pawn push; all overridable by the user.
- **Depends on:** `python-chess`.

### 6.5 `engine`
- **Job:** manage a single active UCI engine; stream multi-PV analysis; expose settings; auto-restart
  on crash.
- **Interface:** `select(engine_id)` (`"stockfish"` | `"stockfish_lite"`), `configure(threads, hash,
  multipv, limit)`, `analyze(board, on_update) -> AnalysisInfo stream`, `stop()`.
- **Detail:** exactly one engine process active at a time; switching engines tears down the old
  process and starts the new one. Built generically over `python-chess`'s UCI support so the two
  presets differ only by binary/net + default config.
- **Engine binaries are downloaded and bundled**, not assumed present on the system. A
  `scripts/fetch_engines.py` tool fetches the correct official Stockfish build for the host
  OS/architecture from the Stockfish GitHub release (currently `sf_18`), extracts it, and places it
  under `chessmenthol/engines/`. Binaries are not committed to the repo (they are fetched at
  setup/build time and bundled into the packaged app). A system `stockfish` on PATH is accepted only
  as a developer fallback.
- **Depends on:** `python-chess`, the downloaded/bundled Stockfish binaries.

### 6.6 `classify_move`
- **Job:** classify a move given before/after positions and engine evals.
- **Interface:** `classify(board_before, move_played, analysis_before, analysis_after, book) ->
  Classification`.
- **Taxonomy & heuristics (approximation, all thresholds tunable):**
  - Centipawn loss (best-eval − played-eval, mover's POV) → **Good / Inaccuracy / Mistake / Blunder**.
  - **Best / Excellent:** played move equals or is within a few cp of the engine's top move.
  - **Book:** position found in a bundled opening book.
  - **Brilliant (!!):** a sound piece sacrifice (gives up material) that remains winning/equalizing
    and is best-or-near.
  - **Great (!):** the only move that holds the evaluation (all alternatives much worse).
  - **Missed (Miss):** a winning tactic existed (eval drops from clearly winning to non-winning) but
    was not played.
- **Depends on:** engine evals (pure function otherwise).

### 6.7 `app` / `api`
- **Job:** run the orchestration loop; serve the frontend; bridge state/commands over WebSocket.
- **Server → client state:** working FEN, mode (`tracking`/`editing`/`exploring`), analysis lines,
  eval, last-move classification, per-square detection confidence, tracking status, active engine.
- **Client → server commands:** `capture_now`, `set_auto_track(bool)`, `set_region`, `toggle_hints`,
  `toggle_arrows`, `toggle_eval_bar`, `set_lines(n)`, `flip_board`, `set_turn(white|black)`,
  `edit_square(square, piece|empty)`, `make_move(uci)` (variation), `sync_to_live`,
  `select_engine(id)`, `set_engine_options(...)`.
- **Depends on:** `fastapi`, `uvicorn`, the core modules.

### 6.8 `frontend`
- **Job:** render state and emit commands.
- **Components:** chessground board (arrows + classification badge overlay); eval bar with numeric
  score; multi-PV line list; move list with per-move quality dots; sectioned control strip —
  **◉ Source** (Auto-track ●, Capture now, Select region), **👁 Display** (Hints, Arrows, Eval bar,
  # lines), **♟ Position** (White/Black turn toggle, Flip, Edit), **⚙ Engine** (engine dropdown with
  the two presets, Depth/Time, Threads, Hash, Options).
- **Depends on:** `chessground`, the WebSocket API.

## 7. Data flow & state

The orchestration loop:
`grab_if_changed → board_detect → piece_classify → position(FEN) → if FEN changed: engine.analyze
(stream) + classify_move(prev, cur) → push AppState over WebSocket → UI renders`.

Two positions are kept **distinct** so user interaction never fights the tracker:
- **Live detected position** — produced by the CV loop while auto-tracking.
- **Working position** — what is analyzed and displayed. Editing a square or playing a variation move
  forks the working position; **Sync to live** snaps it back to the detected position and resumes
  tracking. While the user is editing or exploring, auto-tracking pauses and the UI shows a
  "new position detected — sync?" nudge when the live board changes.

## 8. Error handling

- **No board found:** show a "searching…" state; do not update the position.
- **Illegal/ambiguous CV result:** flag it, show the best-guess FEN, prompt the user to fix it in edit
  mode; **never send an illegal FEN to the engine**.
- **Side-to-move ambiguity:** use the last-move-highlight heuristic; the explicit White/Black toggle
  is always available to correct it.
- **Engine crash:** auto-restart the process and resume analysis of the current position.
- **Multiple board-like regions:** pick the largest; let the user re-select the region to disambiguate.

## 9. Packaging

- **Stockfish is downloaded and bundled**, not installed by the user. `scripts/fetch_engines.py`
  downloads the correct official Stockfish build for the target OS/arch (from release `sf_18`),
  extracts it, and stages it under `chessmenthol/engines/` to be picked up by the packager. The
  binaries are git-ignored (fetched on demand), so the repo stays small.
- Bundle the ONNX piece model alongside the engine(s).
- Build with **PyInstaller** per platform (Windows, macOS, Linux), running `fetch_engines.py` first so
  the platform's Stockfish is included. pywebview uses the OS webview, so no Chromium is bundled —
  binaries stay small.
- CI builds for the three platforms (each runs `fetch_engines.py` for its own OS/arch).

## 10. Testing strategy (TDD throughout)

- **Vision:** a fixture set of labeled screenshots (multiple sites/themes) plus synthetic renders with
  ground-truth FENs → assert board bbox + FEN accuracy; track an accuracy metric over time.
- **Position assembly:** unit tests for orientation / side-to-move / castling heuristics and
  move-diff inference (including edge cases: castling, promotion, en-passant, captures).
- **Move classification:** golden cases with known positions + evals → expected labels (include a
  known brilliancy, a blunder, a book move, a missed win).
- **Engine:** integration test that each engine launches, returns `bestmove`, and streams multi-PV;
  engine-switch tears down/starts up cleanly; crash auto-restart works.
- **Backend/API:** WebSocket command/state round-trip tests.
- **Frontend:** component tests for board rendering from FEN, eval bar, classification badges, and the
  control toggles; a smoke test that the app window loads and renders a position.

## 11. Build order (milestones)

Ordered to deliver a usable analysis app early and de-risk the hard CV last.

1. **Engine + chess core** — UCI wrapper for both bundled engines, multi-PV streaming, move
   classification on known FENs. Validate via a CLI (no UI, no CV yet).
2. **Frontend skeleton** — board from FEN, eval bar, multi-PV lines, sectioned controls, WebSocket
   wiring; driven by a manually entered FEN. *Deliverable: a usable manual analysis board.*
3. **Capture + board detection** — monitor/region selection, locate board, crop 64 squares, debug
   overlay.
4. **Piece classifier** — synthetic dataset generation, train CNN, ONNX inference, assemble FEN; wire
   into the live capture loop. *Deliverable: live screen → analysis.*
5. **Polish** — hybrid auto/manual tracking with pause, edit mode, variation exploration,
   classification badges, engine switching + settings UI, packaging for all three OSes.

## 12. Risks & open questions

- **Piece-classifier generalization** is the primary technical risk. Mitigation: synthetic-data
  breadth + a real-screenshot validation set + per-square confidence flagging + edit-mode correction.
- **Board detection on unusual themes** (low-contrast boards, boards with heavy piece shadows/3-D
  styling). Mitigation: geometric grid detection independent of colour; validation fixtures.
- **Stockfish Lite definition** — confirmed as a lighter build (smaller/faster net + conservative
  defaults). Exact net/binary to ship is a packaging-time choice.
- **Opening book** source for the "Book" classification (a small bundled Polyglot book is sufficient).
- **Move-classification thresholds** will need empirical tuning against real games to feel right.
