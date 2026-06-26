# Milestone 4c — Live Integration — Design Spec

**Date:** 2026-06-26
**Status:** Approved for planning
**Parent:** [`2026-06-24-chessmenthol-design.md`](2026-06-24-chessmenthol-design.md) §5 architecture, §6.7 app/api, §7 data flow, §8 error handling
**Siblings:** M4a [`2026-06-25-milestone-4a-position-assembly-design.md`], M4b [`2026-06-25-milestone-4b-piece-classifier-design.md`]

## 1. Overview

M4c is the final M4 sub-project: it wires the vision pipeline built in M3/M4a/M4b into the live M2
app, so that turning on **Auto-track** makes the rendered board mirror a chess position detected from
the screen, with Stockfish analyzing it live. It connects the existing pieces —
`Capturer` (M3) → `detect`/`crop_squares` (M3) → `PieceClassifier` (M4b) → `assemble` (M4a) → the M2
`Orchestrator`/`EngineManager` — behind a background tracking loop.

**Scope is deliberately minimal** ("live screen → analysis", the build-order deliverable). The richer
tracking UX — the live-vs-working two-position fork, the "new position detected — sync?" nudge,
edit-mode piece correction, tracking pause, interactive region selection, and variation exploration —
is **Milestone 5 (Polish)**, per the parent spec §11.

## 2. Goals

- A **Tracker** that turns one captured frame into an `AssembledPosition` (capture → detect → classify
  → bridge → assemble), with orientation/side-to-move overrides.
- A background **tracking loop** that, while Auto-track is on, polls the screen and feeds detected
  **legal** positions into the existing analysis pipeline (`Orchestrator.set_fen`).
- New WebSocket commands `set_auto` and `capture_now`, and new state fields reporting tracking status.
- A light frontend: enable the existing **Auto** / **Capture** Source buttons, show a vision-status
  line, and let the board orientation follow the detected orientation.
- Full unit-test coverage with injected fakes (no real screen/model/engine needed in CI); manual
  end-to-end verification against a real board on screen.

## 3. Non-Goals (this milestone → M5)

- **No live-vs-working two-position state machine, no "sync?" nudge, no tracking pause.** While
  Auto-track is ON the displayed board follows the screen; to interact manually the user turns it OFF.
- **No edit mode** (manual piece correction of a misdetection).
- **No interactive region/monitor drag-select.** M4c captures the full primary monitor and finds the
  board within it.
- **No variation exploration / classification-badge polish beyond what M2 already renders.**
- **No new runtime dependencies.** Uses M3/M4a/M4b modules + the M2 server, all already present.
- **No retraining/model changes.**

## 4. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Scope | Minimal "live tracking → analysis"; defer fork/sync/edit/pause/region to M5. |
| Decomposition | **One milestone** (frontend work is light: enable 2 buttons + a status line). |
| Position injection seam | `Orchestrator.set_fen(fen)` — the existing single position-injection path. The tracking loop calls it for detected legal positions. |
| Loop architecture | A daemon-thread `TrackingLoop` mirroring `AnalysisSession`'s threading style; per-tick work in a `_tick()` method so tests drive it without a real thread. |
| Module placement | `chessmenthol/vision/tracker.py` (`Tracker`, vision-domain) + `chessmenthol/server/tracking.py` (`TrackingLoop`, server-domain). Keeps `orchestrator.py` focused. |
| Capture target | Full primary monitor; the detector finds the board within it (proven in M3). |
| Manual-vs-auto | Auto ON → board follows screen; manual interaction → user turns Auto OFF. No fork. |
| Illegal / low-confidence | Illegal → never analyzed (gate on `is_legal`), status reported. Low-confidence but legal → analyzed (best guess) + flagged. |

## 5. Components & interfaces

### 5.1 `Tracker` (`chessmenthol/vision/tracker.py`)
Owns a `Capturer`, a `PieceClassifier`, `prev_board: chess.Board | None`, and overrides
`orientation_override: str | None`, `side_override: chess.Color | None`. Depends on M3 `capture`/
`detect`, M4b `pieces`, M4a `position`.

```
class Tracker:
    def __init__(self, capturer=None, classifier=None): ...   # default real; injectable for tests
    def set_orientation_override(self, orientation: str | None) -> None
    def set_side_override(self, side: chess.Color | None) -> None
    def reset(self) -> None                                    # clears prev_board
    def detect_position(self, frame: Frame | np.ndarray | None = None) -> AssembledPosition | None
```

`detect_position`:
1. `frame = frame or capturer.grab()`.
2. `location = detect(frame)`; if `None` → return `None` (no board found).
3. `crops = crop_squares(frame, location)` (flat `a1..h8`); `labels = classifier.classify(crops)`.
4. `orientation = orientation_override or location.orientation_hint or guess_orientation(grid) or
   "white_bottom"`.
5. **Bridge** flat → geometric grid:
   `label_by_name = {c.square: l for c, l in zip(crops, labels)}`;
   `grid[row][col] = label_by_name[square_name(col, row, orientation)]`.
6. `side = side_override if set else guess_side_to_move(<assembled board>, prev_board, move,
   location.highlight_squares)` — computed against a provisional assemble or from prev/highlight (see
   §8 note on the two-pass ordering).
7. `assembled = assemble(grid, orientation=orientation, side_to_move=side, prev_board=prev_board)`.
8. If `assembled.is_legal`: `prev_board = assembled.board`. Return `assembled`.

The `Tracker` performs no I/O beyond the injected `capturer`/`classifier`, so a `FakeBackend` capturer
+ a fake classifier make it fully unit-testable.

### 5.2 `TrackingLoop` (`chessmenthol/server/tracking.py`)
A daemon thread that polls the tracker while enabled.

```
class TrackingLoop:
    def __init__(self, tracker, on_result, *, interval=0.3, change_threshold=2.0): ...
    def start(self) -> None        # idempotent; spawns the daemon thread
    def stop(self) -> None         # signals + joins (timeout), like AnalysisSession.stop
    def tick_once(self) -> None    # one-shot: grab_if_changed -> detect -> on_result (used by capture_now and tests)
    def _run(self) -> None         # loop: while not stopped: tick_once(); sleep(interval)
```

`tick_once` grabs via `capturer.grab_if_changed` (skip unchanged frames), runs
`tracker.detect_position(frame)`, and calls `on_result(assembled_or_None)`. `on_result` is supplied by
the Orchestrator. Per-tick work is isolated in `tick_once` so tests call it directly with a
`FakeTracker` — no real thread, screen, or model.

### 5.3 `Orchestrator` changes (`chessmenthol/server/orchestrator.py`)
- Owns a `TrackingLoop` (lazily built from an injectable `tracker`); a `threading.Lock` (`_lock`)
  serializes `set_fen`/`_restart`/`handle` across the WS thread and the tracking thread.
- New `handle` types: `set_auto` (`{"on": bool}`) and `capture_now` (`{}`).
  - `set_auto(true)` → `tracking_loop.start()`, `_tracking=True`; `set_auto(false)` → `stop()`.
  - `capture_now()` → `tracking_loop.tick_once()` once (works regardless of auto).
- `_on_tracked(assembled)` callback (the loop's `on_result`):
  - `None` → `_vision_status="searching"`; push state (no analysis change).
  - not legal → `_vision_status="searching"`; push state; do **not** call `set_fen`. (An illegal
    detection is surfaced as "searching" — the loop simply hasn't locked a usable position; a distinct
    "illegal" status with an edit-mode prompt is M5.)
  - legal → set `_vision_status` to `"low_confidence"` if `assembled.low_confidence` else `"tracking"`;
    `_detected_orientation=assembled.orientation`; `_low_confidence=assembled.low_confidence`; if
    `assembled.fen != self._board.fen()` → `set_fen(assembled.fen)` (restarts analysis); else just push
    state.
- Existing `set_turn`/flip: while tracking, `set_turn` also calls `tracker.set_side_override(...)` so
  the user's correction sticks across frames. (Flip is a frontend-local orientation change in M4c; an
  orientation *override* into the tracker is a small extension noted for M5, but M4c wires `set_turn`
  → side override since the backend already has that command.)
- `close()` stops the loop and closes the tracker's capturer.

### 5.4 State frame additions (`serialize.py` / `_state_frame`)
Add to the outgoing `state` frame (existing fields unchanged):
```
"tracking": bool,                # auto-track on/off
"visionStatus": "off" | "searching" | "tracking" | "low_confidence",
"detectedOrientation": "white" | "black" | null,
"lowConfidence": [ "<square>", ... ],   # algebraic names, possibly empty
```

### 5.5 Frontend
- `lib/types.ts`: extend `Command` with `{type:'set_auto', on:boolean}` and `{type:'capture_now'}`;
  extend `StateFrame` with the four fields above.
- `lib/ws.ts`: `applyFrame` already stores the whole frame; expose the new fields via the existing
  `state` store (no structural change). Optionally a derived `tracking` store for convenience.
- `Controls.svelte`: enable the **Auto** button (toggle → `set_auto {on}`, reflecting `state.tracking`)
  and the **Capture** button (→ `capture_now`). Add a small **vision-status** line driven by
  `visionStatus`/`lowConfidence` ("tracking ●", "searching…", "N uncertain"). **Region** stays
  disabled.
- `App.svelte`: when `state.detectedOrientation` is set and tracking is on, set the board
  `orientation` from it; the **Flip** button remains a manual local override.

## 6. Data flow

```
Auto ON → TrackingLoop thread (every ~300ms):
  grab_if_changed → Tracker.detect_position → AssembledPosition | None
      → Orchestrator._on_tracked (under _lock):
           legal & changed → set_fen(fen) → AnalysisSession restarts → state pushed
           else            → update visionStatus/lowConfidence → state pushed
Capture now → one tick_once on demand (auto off or on).
```

## 7. Error handling (parent §8)

- **No board found / capture returns black (Wayland):** `detect` → `None` → `visionStatus="searching"`;
  the last analyzed position remains; manual FEN entry still works.
- **Illegal assembled position:** gated by `is_legal`; never sent to the engine; status reflects it.
- **Low-confidence (legal):** analyzed as the best guess; `lowConfidence` squares reported for the UI.
- **Engine crash during tracking:** unchanged from M2 (`EngineManager`/session handle it); the next tick
  re-pushes the current position.
- **Thread races:** the Orchestrator `_lock` serializes board mutation/analysis-restart between the WS
  thread and the tracking thread; `TrackingLoop.stop()` joins with a timeout like `AnalysisSession`.
- **mss thread-affinity:** the `Capturer`/`MssBackend` is used only from the tracking thread (mss
  instances are not shared across threads); the loop owns it.

## 8. Notable design points

- **Side-to-move two-pass:** `guess_side_to_move` needs a board to read the highlighted destination's
  piece color, but `assemble` needs the side. M4c resolves this by assembling once with a provisional
  side (e.g. the override, else `prev_board`-alternation, else white) to get a board, computing the
  side guess from it + the highlight, then — only if it differs and no override — assembling a second
  time. This is cheap (pure python-chess) and keeps `assemble` unchanged. Documented so the plan
  implements it explicitly rather than guessing.
- **Change-detection:** the loop uses `Capturer.grab_if_changed` so a static screen costs almost
  nothing; the analysis only restarts when the detected FEN actually changes.

## 9. Testing strategy (TDD)

- **`Tracker`** (`tests/vision/test_tracker.py`): build a synthetic board (M3 `render_board`/fixtures),
  run the **real** `detect`+`crop_squares`, feed a **fake classifier** that returns the *true* label per
  crop (we know the board) → assert `detect_position` reproduces the known FEN (validates the
  flat→geometric **bridge** end-to-end without a real model); orientation override flips the mapping;
  side override is honored; move inference across two consecutive frames; a no-board frame → `None`;
  low-confidence labels propagate to `assembled.low_confidence`.
- **`TrackingLoop`** (`tests/server/test_tracking.py`): with a `FakeTracker` returning scripted
  `AssembledPosition|None`, `tick_once` calls `on_result` with the right value; `start`/`stop` manage
  the thread cleanly (a short real-thread test that asserts at least one tick then stops).
- **`Orchestrator`** (`tests/server/test_orchestrator.py`): with a `FakeTracker`/injected loop, `set_auto`
  toggles tracking and emits the new state fields; `capture_now` triggers one tick; a legal detected
  position drives `set_fen`; an illegal one does not; `set_turn` while tracking sets the side override.
- **Server WS** (`tests/server/test_app.py`): `set_auto`/`capture_now` command round-trip via
  `FakeOrchestrator`.
- **Frontend** (`frontend/src/tests/`): `ws.test.ts` — `applyFrame` surfaces the new fields;
  `Controls.test.ts` — Auto/Capture enabled, emit `set_auto`/`capture_now`, status line renders from
  `visionStatus`.
- **Manual** (documented, not CI): run `chessmenthol-app`/`-server`, open a real board on screen, toggle
  Auto-track, confirm the rendered board mirrors it and analysis updates. (On Wayland, capture may be
  black — the known M3 limitation.)

## 10. Deliverable / acceptance

- Toggling **Auto-track** makes the rendered board follow a chess position on screen, with live
  Stockfish analysis; **Capture now** does a one-shot update; the vision status is visible.
- Detected **illegal** positions never reach the engine; **low-confidence** squares are reported.
- All unit tests pass with injected fakes (no screen/model/engine in CI); the M2 manual board still
  works with Auto-track off.
- No new dependencies. `vision/tracker.py` and `server/tracking.py` are the only new modules; changes to
  `orchestrator.py`/`serialize.py` and the frontend `types.ts`/`Controls.svelte`/`App.svelte` are
  additive.

## 11. Risks & open questions

- **Real-screen generalization:** detection+classification were validated on synthetic + the chess-cv
  real dataset, not yet on arbitrary live sites end-to-end. Per-square confidence + the "searching"
  state keep failures non-destructive; M5's edit mode adds correction. Manual verification is the real
  test.
- **Wayland capture** on the dev machine may return black frames (M3 limitation). The file/manual path
  and a future portal backend (M5) cover it; tracking degrades gracefully to "searching".
- **Tracking latency vs CPU:** the ~300 ms interval + `grab_if_changed` is a starting point; tunable.
  Detection+classification on one frame is cheap (small CNN over 64 crops via `cv2.dnn`).
- **Orientation auto-follow vs manual flip:** M4c auto-follows detected orientation while tracking and
  keeps Flip as a local override; the full override-feedback-into-the-tracker loop is an M5 refinement.
