# Milestone 4c — Live Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the vision pipeline (capture→detect→classify→assemble) into the live M2 app so an **Auto-track** toggle makes the rendered board mirror a chess position detected on screen, with live Stockfish analysis.

**Architecture:** A `Tracker` (vision-layer) turns one frame into an `AssembledPosition`; a `TrackingLoop` (server-layer daemon thread) polls it while enabled and hands legal detected positions to the existing `Orchestrator.set_fen`. The frontend enables the existing Auto/Capture buttons and shows a vision-status line. Minimal scope: the live-vs-working fork, edit mode, sync nudge, pause, and region-select are M5.

**Tech Stack:** Python (`python-chess`, `cv2`, `numpy`, threading), FastAPI WebSocket, Svelte/TS. No new deps.

**Reference spec:** `docs/superpowers/specs/2026-06-26-milestone-4c-live-integration-design.md`

**Conventions:** Every Python file starts with `from __future__ import annotations`. Run Python tests with `.venv/bin/pytest`; frontend with `cd frontend && npm run test`. Modification tasks: **read the target file first** to find exact insertion points; the plan gives the complete new code.

**Key established facts (from codebase exploration — do not re-derive):**
- `Orchestrator` (`chessmenthol/server/orchestrator.py`): `handle(cmd: dict)` dispatches by `cmd["type"]`; `set_fen(fen)` parses a board, stops the session, calls `_restart()`; `_restart()` (re)starts `AnalysisSession` and calls `self._send(self._state_frame(...))`; `_send` is a callback set by `app.py`. Constructor accepts injectable `engine`/`session_factory`. `_state_frame()` builds the outgoing dict.
- `app.py` forwards every incoming WS message to `orchestrator.handle(cmd)` — **new command types route automatically**; no app.py change needed beyond a round-trip test.
- M3 `crop_squares(frame, location) -> list[SquareImage]` returns 64 crops **sorted `a1..h8`**, each `.square` named via `square_name(col, row, location.orientation_hint)`. M4a `assemble(grid, *, orientation, side_to_move, prev_board)` wants an 8×8 **geometric** `grid[row][col]` (row0=top). M4a `square_name` lives in `chessmenthol/vision/types.py`. M4a `guess_orientation(grid)`, `guess_side_to_move(board, *, prev_board, move, highlight_squares)`, `SquareLabel`, `AssembledPosition`, `assemble` are in `chessmenthol/position.py`.
- M4b `PieceClassifier().classify(crops) -> list[SquareLabel]` in input order.
- Test patterns: `tests/server/test_orchestrator.py` uses a `FakeSession`; `tests/server/test_app.py` uses `FakeOrchestrator` + `TestClient.websocket_connect`; `tests/vision/` uses `render_board` (`tests/vision/synthetic.py`) + `FakeBackend` (`tests/vision/fakes.py`). Frontend `frontend/src/tests/ws.test.ts` tests `applyFrame` against stores; `Controls.test.ts` renders with `@testing-library/svelte`.

---

## File Structure

| File | Responsibility |
|---|---|
| `chessmenthol/vision/tracker.py` | **Create** — `Tracker`: frame → `AssembledPosition`, the crop→grid bridge, overrides |
| `chessmenthol/server/tracking.py` | **Create** — `TrackingLoop`: daemon thread polling the tracker |
| `chessmenthol/server/orchestrator.py` | **Modify** — `set_auto`/`capture_now`, `_on_tracked`, `_lock`, new state fields, `set_turn`→override |
| `frontend/src/lib/types.ts` | **Modify** — new commands + StateFrame fields |
| `frontend/src/components/Controls.svelte` | **Modify** — enable Auto/Capture, vision-status line |
| `frontend/src/App.svelte` | **Modify** — orientation auto-follow; route auto/capture commands |
| `tests/vision/test_tracker.py`, `tests/server/test_tracking.py` | **Create** — unit tests |
| `tests/server/test_orchestrator.py`, `tests/server/test_app.py` | **Modify** — new commands/state |
| `frontend/src/tests/ws.test.ts`, `Controls.test.ts` | **Modify** — new fields/buttons |

---

## Task 1: `Tracker` — frame → AssembledPosition (the bridge)

**Files:**
- Create: `chessmenthol/vision/tracker.py`
- Test: `tests/vision/test_tracker.py`

- [ ] **Step 1: Write the failing test**

Create `tests/vision/test_tracker.py`:

```python
from __future__ import annotations

import chess

from chessmenthol.vision.capture import Capturer
from chessmenthol.vision.tracker import Tracker
from chessmenthol.position import SquareLabel
from chessmenthol.vision.types import Monitor
from tests.vision.fakes import FakeBackend
from tests.vision.synthetic import render_board


class FakeClassifier:
    """Returns the TRUE label for each crop based on its .square name and a known board."""

    def __init__(self, board: chess.Board):
        self.board = board

    def classify(self, crops):
        return [
            SquareLabel(self.board.piece_at(chess.parse_square(c.square)), 1.0)
            for c in crops
        ]


def _tracker_for(board: chess.Board, img) -> Tracker:
    backend = FakeBackend([Monitor(0, 0, 0, img.shape[1], img.shape[0])], [img, img, img])
    return Tracker(capturer=Capturer(backend=backend), classifier=FakeClassifier(board))


def test_tracker_reproduces_known_position():
    board = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3")
    occupied = [chess.square_name(sq) for sq in chess.SQUARES if board.piece_at(sq)]
    img, _ = render_board(square=48, margin=24, pieces=occupied)
    ap = _tracker_for(board, img).detect_position()
    assert ap is not None and ap.is_legal
    assert ap.board.board_fen() == board.board_fen()


def test_tracker_returns_none_when_no_board():
    import numpy as np
    board = chess.Board()
    noise = np.random.default_rng(0).integers(0, 255, (300, 300, 3), dtype=np.uint8)
    backend = FakeBackend([Monitor(0, 0, 0, 300, 300)], [noise])
    tracker = Tracker(capturer=Capturer(backend=backend), classifier=FakeClassifier(board))
    assert tracker.detect_position() is None


def test_tracker_side_override_is_honored():
    board = chess.Board()
    occupied = [chess.square_name(sq) for sq in chess.SQUARES if board.piece_at(sq)]
    img, _ = render_board(square=48, margin=24, pieces=occupied)
    tracker = _tracker_for(board, img)
    tracker.set_side_override(chess.BLACK)
    ap = tracker.detect_position()
    assert ap is not None and ap.side_to_move == chess.BLACK
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/vision/test_tracker.py -v`
Expected: FAIL — `ModuleNotFoundError: chessmenthol.vision.tracker`.

- [ ] **Step 3: Implement the Tracker**

Create `chessmenthol/vision/tracker.py`:

```python
from __future__ import annotations

from typing import Optional, Union

import chess
import numpy as np

from chessmenthol.position import (
    AssembledPosition,
    assemble,
    guess_orientation,
    guess_side_to_move,
)

from .capture import Capturer
from .detect import crop_squares, detect
from .pieces import PieceClassifier
from .types import Frame, square_name

ImageLike = Union[Frame, np.ndarray]


class Tracker:
    """Turns one captured frame into an AssembledPosition.

    Pipeline: grab -> detect -> crop_squares -> classify -> bridge to an 8x8
    geometric grid -> assemble. Orientation/side overrides let the UI correct
    the detection; they persist across frames (via prev_board for move inference).
    """

    def __init__(
        self,
        capturer: Optional[Capturer] = None,
        classifier: Optional[PieceClassifier] = None,
    ) -> None:
        self._capturer = capturer if capturer is not None else Capturer()
        self._classifier = classifier if classifier is not None else PieceClassifier()
        self._capturer.select_monitor(0)  # default: full primary monitor
        self._prev_board: Optional[chess.Board] = None
        self._orientation_override: Optional[str] = None
        self._side_override: Optional[chess.Color] = None

    def set_orientation_override(self, orientation: Optional[str]) -> None:
        self._orientation_override = orientation

    def set_side_override(self, side: Optional[chess.Color]) -> None:
        self._side_override = side

    def reset(self) -> None:
        self._prev_board = None

    def detect_position(
        self, frame: Optional[ImageLike] = None
    ) -> Optional[AssembledPosition]:
        if frame is None:
            frame = self._capturer.grab()
        location = detect(frame)
        if location is None:
            return None
        crops = crop_squares(frame, location)
        labels = self._classifier.classify(crops)

        # Bridge: recover the geometric grid using the SAME orientation crop_squares
        # named the crops with (location.orientation_hint). assemble then applies the
        # resolved orientation, so an override flips the chess mapping without re-cropping.
        label_by_name = {c.square: lab for c, lab in zip(crops, labels)}
        grid = [
            [label_by_name[square_name(col, row, location.orientation_hint)] for col in range(8)]
            for row in range(8)
        ]

        orientation = (
            self._orientation_override
            or location.orientation_hint
            or guess_orientation(grid)
            or "white_bottom"
        )
        side = self._resolve_side(grid, orientation, location)
        assembled = assemble(
            grid, orientation=orientation, side_to_move=side, prev_board=self._prev_board
        )
        if assembled.is_legal:
            self._prev_board = assembled.board
        return assembled

    def _resolve_side(self, grid, orientation, location) -> chess.Color:
        if self._side_override is not None:
            return self._side_override
        # Two-pass: assemble provisionally to get a board for the highlight/move guess.
        provisional = assemble(
            grid, orientation=orientation, side_to_move=chess.WHITE, prev_board=self._prev_board
        )
        if provisional.board is None:
            return chess.WHITE
        return guess_side_to_move(
            provisional.board,
            prev_board=self._prev_board,
            move=provisional.move,
            highlight_squares=location.highlight_squares,
        )
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/vision/test_tracker.py -v`
Expected: PASS (3 passed). If `test_tracker_reproduces_known_position` fails on the FEN, the bridge is wrong — confirm the grid is built with `location.orientation_hint` (NOT the resolved `orientation`). If `render_board`/`detect` mis-detect, print `detect(frame)` to check the board was found.

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/vision/tracker.py tests/vision/test_tracker.py
git commit -m "feat(vision): add Tracker (frame -> AssembledPosition with crop->grid bridge)"
```

---

## Task 2: `TrackingLoop` — daemon thread polling the tracker

**Files:**
- Create: `chessmenthol/server/tracking.py`
- Test: `tests/server/test_tracking.py`

- [ ] **Step 1: Write the failing test**

Create `tests/server/test_tracking.py`:

```python
from __future__ import annotations

import threading
import time

from chessmenthol.server.tracking import TrackingLoop


class FakeTracker:
    def __init__(self, results):
        self._results = list(results)
        self.calls = 0

    def detect_position(self, frame=None):
        self.calls += 1
        idx = min(self.calls - 1, len(self._results) - 1)
        return self._results[idx]


def test_tick_once_calls_on_result():
    seen = []
    loop = TrackingLoop(FakeTracker(["POS_A"]), on_result=seen.append)
    loop.tick_once()
    assert seen == ["POS_A"]


def test_tick_once_passes_none_through():
    seen = []
    loop = TrackingLoop(FakeTracker([None]), on_result=seen.append)
    loop.tick_once()
    assert seen == [None]


def test_start_runs_ticks_then_stop_joins():
    seen = []
    event = threading.Event()

    def on_result(r):
        seen.append(r)
        event.set()

    loop = TrackingLoop(FakeTracker(["X", "X", "X"]), on_result=on_result, interval=0.01)
    loop.start()
    assert event.wait(timeout=2.0), "expected at least one tick"
    loop.stop()
    assert not loop.is_running()
    assert len(seen) >= 1
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/server/test_tracking.py -v`
Expected: FAIL — `ModuleNotFoundError: chessmenthol.server.tracking`.

- [ ] **Step 3: Implement TrackingLoop**

Create `chessmenthol/server/tracking.py`:

```python
from __future__ import annotations

import threading
import time
from typing import Callable, Optional

# on_result receives an AssembledPosition or None each tick.
OnResult = Callable[[Optional[object]], None]


class TrackingLoop:
    """Daemon thread that polls a tracker while enabled. Per-tick work lives in
    `tick_once` so it can be driven directly (capture_now, tests) without a thread."""

    def __init__(self, tracker, on_result: OnResult, *, interval: float = 0.3) -> None:
        self._tracker = tracker
        self._on_result = on_result
        self._interval = interval
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    def tick_once(self) -> None:
        result = self._tracker.detect_position()
        self._on_result(result)

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.tick_once()
            except Exception:
                # A bad frame/detection must not kill the loop; skip and continue.
                pass
            self._stop.wait(self._interval)

    def stop(self) -> None:
        with self._lock:
            self._stop.set()
            thread = self._thread
            self._thread = None
        if thread is not None:
            thread.join(timeout=2.0)

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/server/test_tracking.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/server/tracking.py tests/server/test_tracking.py
git commit -m "feat(server): add TrackingLoop daemon polling the tracker"
```

---

## Task 3: Orchestrator wiring — set_auto / capture_now / state fields

**Files:**
- Modify: `chessmenthol/server/orchestrator.py`
- Test: `tests/server/test_orchestrator.py`

**Read `orchestrator.py` fully first.** You will: add a `threading.Lock`, an injectable `tracker`, a `TrackingLoop`, the new vision state, handle the new command types, and add `_on_tracked`. The exact field/method names below must integrate with the existing `handle`/`set_fen`/`_restart`/`_state_frame`/`_send`.

- [ ] **Step 1: Add failing tests**

Append to `tests/server/test_orchestrator.py` (reuse the file's existing `FakeSession` and frame-collecting `send`; import `chess` and the position type as needed):

```python
import chess

from chessmenthol.position import assemble, SquareLabel


class FakeTracker:
    def __init__(self, result):
        self.result = result
        self.side_override = None
    def detect_position(self, frame=None):
        return self.result
    def set_side_override(self, side):
        self.side_override = side
    def set_orientation_override(self, o):
        pass
    def reset(self):
        pass


def _legal_assembled(fen):
    board = chess.Board(fen)
    grid = [[SquareLabel(None, 1.0) for _ in range(8)] for _ in range(8)]
    for sq in chess.SQUARES:
        p = board.piece_at(sq)
        if p:
            grid[7 - chess.square_rank(sq)][chess.square_file(sq)] = SquareLabel(p, 1.0)
    return assemble(grid, orientation="white_bottom", side_to_move=board.turn)


def test_capture_now_legal_detection_drives_set_fen(make_orchestrator):
    # make_orchestrator is the existing test helper; pass a FakeTracker via the new param.
    target = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(_legal_assembled(target)), send=frames.append)
    orch.handle({"type": "capture_now"})
    assert orch._board.board_fen() == chess.Board(target).board_fen()
    assert frames and frames[-1]["visionStatus"] in ("tracking", "low_confidence")


def test_set_auto_toggles_tracking_state(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    orch.handle({"type": "set_auto", "on": True})
    assert frames[-1]["tracking"] is True
    orch.handle({"type": "set_auto", "on": False})
    assert frames[-1]["tracking"] is False


def test_illegal_detection_does_not_change_board(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    before = orch._board.fen()
    orch.handle({"type": "capture_now"})
    assert orch._board.fen() == before
    assert frames[-1]["visionStatus"] == "searching"
```

If the test file lacks a `make_orchestrator` fixture/helper that accepts `tracker=`/`send=`, add a small one mirroring the existing construction (inject `session_factory=FakeSession`, the new `tracker=`, and `send=`). Keep it consistent with the existing tests.

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py -k "capture_now or set_auto or illegal_detection" -v`
Expected: FAIL — unknown command types / missing `tracker` param.

- [ ] **Step 3: Implement the wiring**

In `chessmenthol/server/orchestrator.py`:

1. Imports: add `import threading` and `from .tracking import TrackingLoop`.
2. Constructor: add a parameter `tracker=None` (store as `self._tracker = tracker`); add `self._lock = threading.Lock()`; add vision state `self._tracking = False`, `self._vision_status = "off"`, `self._detected_orientation = None`, `self._low_confidence: list[str] = []`; create `self._loop = TrackingLoop(self._tracker, self._on_tracked) if self._tracker is not None else None`. (When `tracker is None` and a real run needs tracking, build it lazily in `_ensure_loop` — see below.)
3. Wrap the body of `handle`, `set_fen`, and `_restart` so board mutation is serialized: acquire `self._lock` at the top of `handle` (a `with self._lock:` around the dispatch is simplest; ensure `_on_tracked` does NOT re-acquire it — see note). Simplest correct approach: keep `handle` taking the lock, and have `_on_tracked` take the lock itself (since it is called from the tracking thread, not from within `handle`).
4. Extend the `handle` dispatch with:

```python
        elif kind == "set_auto":
            self._set_auto(bool(cmd.get("on")))
        elif kind == "capture_now":
            self._capture_now()
```

5. Add these methods:

```python
    def _ensure_loop(self) -> None:
        if self._loop is None:
            from chessmenthol.vision.tracker import Tracker
            self._tracker = Tracker()
            self._loop = TrackingLoop(self._tracker, self._on_tracked)

    def _set_auto(self, on: bool) -> None:
        self._tracking = on
        if on:
            self._ensure_loop()
            self._loop.start()
            self._vision_status = "searching"
        else:
            if self._loop is not None:
                self._loop.stop()
            self._vision_status = "off"
        self._send(self._state_frame())

    def _capture_now(self) -> None:
        self._ensure_loop()
        self._loop.tick_once()

    def _on_tracked(self, assembled) -> None:
        with self._lock:
            if assembled is None or not assembled.is_legal:
                self._vision_status = "searching"
                self._send(self._state_frame())
                return
            self._detected_orientation = assembled.orientation
            self._low_confidence = list(assembled.low_confidence)
            self._vision_status = "low_confidence" if assembled.low_confidence else "tracking"
            if assembled.fen.split()[0] != self._board.board_fen():
                self._apply_fen(assembled.fen)  # internal set_fen WITHOUT re-locking
            else:
                self._send(self._state_frame())
```

Refactor `set_fen` into a lock-free internal `_apply_fen(fen)` (the existing body) plus a thin public `set_fen` that the WS path uses; `handle` already holds the lock, and `_on_tracked` holds the lock, so both call `_apply_fen`. (Adjust the existing `set_fen` callers accordingly — `handle`'s `set_fen` branch calls `_apply_fen`.)

6. Extend `_state_frame()` to add the four fields to the returned dict:

```python
            "tracking": self._tracking,
            "visionStatus": self._vision_status,
            "detectedOrientation": self._detected_orientation,
            "lowConfidence": self._low_confidence,
```

7. In the existing `set_turn(white)` handler, if tracking is active and a tracker exists, also push the override so it persists:

```python
        if self._tracker is not None:
            self._tracker.set_side_override(chess.WHITE if white else chess.BLACK)
```

8. In `close()`, stop the loop first: `if self._loop is not None: self._loop.stop()`.

**Locking note:** ensure exactly one lock acquisition per logical operation — `handle` takes `self._lock` once; the methods it calls (`_apply_fen`, `_set_auto`, `_capture_now`) must NOT re-acquire it. `_on_tracked` is the only entry from the tracking thread and acquires the lock itself. `capture_now`→`tick_once`→`_on_tracked` runs on the calling (WS) thread while `handle` holds the lock → that would deadlock. **Fix:** make `_capture_now` run the tick OUTSIDE the held lock — simplest is to have `handle` NOT hold the lock for `capture_now`/`set_auto` (these manage the loop, and `_on_tracked` does its own locking). Concretely: in `handle`, branch on `kind` BEFORE taking the lock for the vision commands:

```python
    def handle(self, cmd: dict) -> None:
        kind = cmd.get("type")
        if kind == "set_auto":
            self._set_auto(bool(cmd.get("on")))
            return
        if kind == "capture_now":
            self._capture_now()
            return
        with self._lock:
            ... existing dispatch (which calls _apply_fen etc.) ...
```

This keeps `_on_tracked` as the sole locker for detected updates, and the board-mutating WS commands locked, with no nested acquisition.

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py -v`
Expected: PASS (existing + 3 new). Watch for deadlocks (a hung test = a double lock-acquire; recheck the locking note).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/server/orchestrator.py tests/server/test_orchestrator.py
git commit -m "feat(server): wire tracking loop into orchestrator (set_auto/capture_now/state)"
```

---

## Task 4: WebSocket round-trip for the new commands

**Files:**
- Modify: `tests/server/test_app.py`

`app.py` already forwards all messages to `orchestrator.handle`, so no app code changes — just prove the new commands reach the orchestrator.

- [ ] **Step 1: Add a failing test**

Append to `tests/server/test_app.py` (reuse the file's existing `FakeOrchestrator` + `create_app(orchestrator_factory=...)` + `TestClient`; if `FakeOrchestrator.handle` records commands, assert on that record):

```python
def test_vision_commands_reach_orchestrator():
    received = []

    class RecordingOrch:
        def __init__(self, send):
            self._send = send
        def handle(self, cmd):
            received.append(cmd)
        def close(self):
            pass

    app = create_app(orchestrator_factory=lambda send: RecordingOrch(send))
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "set_auto", "on": True})
        ws.send_json({"type": "capture_now"})
        # round-trip a no-op to flush ordering if the app echoes; otherwise just close
    assert {"type": "set_auto", "on": True} in received
    assert {"type": "capture_now"} in received
```

Adapt `RecordingOrch`/`create_app` usage to match the file's actual `FakeOrchestrator` and app factory signature (read the file). If the app requires the orchestrator to send an initial frame, have `RecordingOrch.__init__` call `send(...)` as the real one does.

- [ ] **Step 2: Run to verify failure / pass**

Run: `.venv/bin/pytest tests/server/test_app.py -k vision_commands -v`
Expected: PASS once adapted (the routing already exists; this test documents/locks it). If it fails because the app validates command types against a schema, that schema must be extended to allow `set_auto`/`capture_now` — update it.

- [ ] **Step 3: Commit**

```bash
git add tests/server/test_app.py
git commit -m "test(server): cover set_auto/capture_now WebSocket round-trip"
```

---

## Task 5: Frontend protocol types

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Test: `frontend/src/tests/ws.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `frontend/src/tests/ws.test.ts` a case asserting `applyFrame` surfaces the new fields via the `state` store (follow the file's existing `applyFrame` + `get(state)` pattern):

```ts
it('surfaces vision fields from a state frame', () => {
  applyFrame({
    type: 'state', fen: 'startpos', sideToMove: 'white', engineId: 'stockfish',
    analyzing: false, eval: null, depth: 0, lines: [], lastMove: null,
    tracking: true, visionStatus: 'tracking', detectedOrientation: 'black',
    lowConfidence: ['e4'],
  } as any);
  const s = get(state)!;
  expect(s.tracking).toBe(true);
  expect(s.visionStatus).toBe('tracking');
  expect(s.detectedOrientation).toBe('black');
  expect(s.lowConfidence).toEqual(['e4']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test -- ws`
Expected: FAIL — TS type error (the new fields aren't on `StateFrame`/`Command`).

- [ ] **Step 3: Extend the types**

In `frontend/src/lib/types.ts`: add to the `Command` union:

```ts
  | { type: 'set_auto'; on: boolean }
  | { type: 'capture_now' }
```

And add to the `StateFrame` interface/type (alongside the existing fields):

```ts
  tracking: boolean;
  visionStatus: 'off' | 'searching' | 'tracking' | 'low_confidence';
  detectedOrientation: 'white' | 'black' | null;
  lowConfidence: string[];
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm run test -- ws`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/tests/ws.test.ts
git commit -m "feat(frontend): add vision commands and state fields to the protocol types"
```

---

## Task 6: Frontend Controls — enable Auto/Capture + vision status

**Files:**
- Modify: `frontend/src/components/Controls.svelte`
- Test: `frontend/src/tests/Controls.test.ts`

**Read `Controls.svelte` first** — the Source section has `auto-btn`/`capture-btn`/`region-btn` currently `disabled`. The component receives `onCommand` and the server `state` (confirm how state reaches it; if it doesn't, thread the needed props from `App.svelte`).

- [ ] **Step 1: Add failing tests**

Append to `frontend/src/tests/Controls.test.ts` (follow the file's render + `vi.fn()` pattern):

```ts
it('Auto button is enabled and emits set_auto', async () => {
  const onCommand = vi.fn();
  const { getByTestId } = render(Controls, { props: { onCommand, tracking: false /* + other required props */ } as any });
  const btn = getByTestId('auto-btn');
  expect(btn).not.toBeDisabled();
  await fireEvent.click(btn);
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_auto', on: true });
});

it('Capture button emits capture_now', async () => {
  const onCommand = vi.fn();
  const { getByTestId } = render(Controls, { props: { onCommand /* + other required props */ } as any });
  await fireEvent.click(getByTestId('capture-btn'));
  expect(onCommand).toHaveBeenCalledWith({ type: 'capture_now' });
});
```

Fill in any other required props the component needs (match the existing tests' prop list).

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test -- Controls`
Expected: FAIL — buttons are disabled / handlers absent.

- [ ] **Step 3: Implement**

In `Controls.svelte`:
- Add a prop for the current tracking state (e.g. `export let tracking: boolean = false;`) and the vision status fields if shown (`export let visionStatus: string = 'off'; export let lowConfidence: string[] = [];`).
- Remove `disabled` from `auto-btn` and `capture-btn` (keep `region-btn` disabled).
- Wire handlers: `auto-btn` → `onCommand({ type: 'set_auto', on: !tracking })`; `capture-btn` → `onCommand({ type: 'capture_now' })`.
- Reflect state on the Auto button (e.g. active styling / `aria-pressed={tracking}`), and add a small status line, e.g.:

```svelte
<span class="vision-status" data-testid="vision-status">
  {#if visionStatus === 'tracking'}tracking ●
  {:else if visionStatus === 'low_confidence'}● {lowConfidence.length} uncertain
  {:else if visionStatus === 'searching'}searching…
  {:else}—{/if}
</span>
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm run test -- Controls`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Controls.svelte frontend/src/tests/Controls.test.ts
git commit -m "feat(frontend): enable Auto-track/Capture controls and vision status"
```

---

## Task 7: Frontend App — wire commands + orientation auto-follow

**Files:**
- Modify: `frontend/src/App.svelte`

**Read `App.svelte` first.** It holds `orientation` local state and passes `state`/`onCommand` down. No new behavior needs a dedicated test beyond Task 6 (the smoke test covers rendering); keep this task a focused wiring change.

- [ ] **Step 1: Pass tracking state + auto-follow orientation**

In `App.svelte`:
- Pass the vision fields from `state` into `Controls` (`tracking={s?.tracking ?? false}`, `visionStatus={s?.visionStatus ?? 'off'}`, `lowConfidence={s?.lowConfidence ?? []}`).
- Make the board orientation follow detection while tracking, keeping Flip as a manual override. Add a reactive block:

```svelte
  $: if (s?.tracking && s?.detectedOrientation && !manualFlip) {
    orientation = s.detectedOrientation;
  }
```

Introduce `let manualFlip = false;` and set it `true` in `onFlip()` so a manual flip wins until tracking is toggled off (reset `manualFlip = false` when `set_auto` is turned on). (Adapt to the file's existing `onFlip`/`orientation` handling.)

- [ ] **Step 2: Verify the frontend suite + build**

Run: `cd frontend && npm run test`
Expected: PASS (all frontend tests, including the existing smoke test).
Run: `cd frontend && npm run build`
Expected: builds successfully (compiles to `chessmenthol/server/static/`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.svelte
git commit -m "feat(frontend): route auto/capture commands and auto-follow detected orientation"
```

---

## Task 8: Full-suite verification + manual smoke note

**Files:** none (verification only)

- [ ] **Step 1: Python suite**

Run: `.venv/bin/pytest -q`
Expected: all pass (prior + new tracker/tracking/orchestrator/app tests). `convert`-marked and `engine`-marked tests behave as before (skip without their deps).

- [ ] **Step 2: Frontend suite + build**

Run: `cd frontend && npm run test && npm run build`
Expected: all frontend tests pass; build succeeds.

- [ ] **Step 3: Confirm the tracker pipeline imports cleanly**

Run: `.venv/bin/python -c "from chessmenthol.vision.tracker import Tracker; from chessmenthol.server.tracking import TrackingLoop; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Manual smoke (documented; not CI)**

Note in the commit/PR: to verify live, run `.venv/bin/chessmenthol-server` (or `chessmenthol-app`), open a chess board on screen, click **Auto** in the Source section, and confirm the rendered board mirrors the on-screen position with live analysis; **Capture** does a one-shot update. On Wayland, capture may be black (known M3 limitation) — the file/manual FEN path still works.

- [ ] **Step 5: Final commit (only if anything was adjusted)**

```bash
git add -A
git commit -m "test(4c): milestone 4c full-suite verification" || echo "nothing to commit"
```

---

## Self-Review Notes (author)

- **Spec coverage:** Tracker incl. bridge + overrides + two-pass side (§5.1,§8 → Task 1), TrackingLoop (§5.2 → Task 2), orchestrator set_auto/capture_now/_on_tracked/lock/state fields/set_turn-override (§5.3,§5.4,§7 → Task 3), WS round-trip (§6 → Task 4), frontend types (§5.5 → Task 5), Controls enable+status (§5.5 → Task 6), App orientation-follow (§5.5 → Task 7), testing+deliverable (§9,§10 → Task 8). All sections mapped.
- **The bridge correctness lynchpin** (recover geometry via `location.orientation_hint`, late-bind orientation in `assemble`) is encoded in Task 1's code + comment and guarded by the round-trip test.
- **Deadlock risk** (capture_now → tick → _on_tracked while handle holds the lock) is explicitly called out in Task 3 with the fix (vision commands branch before taking the lock; `_on_tracked` is the sole locker for detected updates).
- **Integration uncertainty:** the orchestrator/app/Controls/App edits depend on exact existing structure; each modification task says "read the file first" and gives complete new code with adaptation notes, since the precise insertion points are only knowable at the file.
- **Type consistency:** `Tracker.detect_position`, `set_side_override`/`set_orientation_override`/`reset`; `TrackingLoop(tracker, on_result, *, interval)` with `tick_once`/`start`/`stop`/`is_running`; the four state fields `tracking`/`visionStatus`/`detectedOrientation`/`lowConfidence` are used identically across Tasks 1–7.
```
