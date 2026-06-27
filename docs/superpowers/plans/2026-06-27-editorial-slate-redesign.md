# Editorial Slate Redesign + Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the finalized "Editorial Slate" mockup into the Svelte app and build its foundation features — a linear move history with navigation/redo, classify-on-play move colors, Search-time/Memory engine options, Reset Board, an Analysis on/off switch, four view toggles, and region-gated Capture.

**Architecture:** The backend gains an explicit `history: list[HistoryEntry]` + `cursor` decoupled from the live `chess.Board` (which is rebuilt by replaying entries up to the cursor); navigation re-analyzes the viewed ply; movetime/hash drive the engine; classifications are stored into history when a live move reaches classify-depth. The frontend is re-componentized to mirror the mockup's single analysis card, driven by the extended WebSocket `state` frame.

**Tech Stack:** Python (`python-chess`, FastAPI WS), pytest. Svelte 5 + chessground + chess.js, TypeScript, Vitest. Mockup source of truth: `docs/frontend-redesign-editorial-slate.html` (referred to below as **MOCKUP**, with line numbers).

**Spec:** `docs/superpowers/specs/2026-06-27-editorial-slate-redesign-design.md`

---

## File Structure

### Backend (modify)
- `chessmenthol/server/orchestrator.py` — add `HistoryEntry`, history/cursor state, `_rebuild_board`, `_play_move`; rewrite `make_move`/`undo`/`play_best`/`set_turn`/`_apply_fen`; add `navigate`/`reset`/`set_analysis_enabled`; movetime in `set_options`; classify-into-history; new `_state_frame` fields; `_restart` gating; `_on_search_done`.
- `chessmenthol/server/session.py` — add public `on_done` callback fired on natural stream completion.
- `chessmenthol/engine/manager.py` — `stream_analysis` allows true-infinite (no depth=18 fallback).
- `chessmenthol/server/serialize.py` — no new functions required (reuses `classification_to_dict`); moveList is built inline in the orchestrator.

### Frontend (create)
- `frontend/src/lib/options.ts` — Search-time / Memory slider value↔label maps.
- `frontend/src/lib/moveclass.ts` — classification label → move-list CSS class.
- `frontend/src/components/Switch.svelte` — reusable toggle switch.
- `frontend/src/components/RangeSlider.svelte` — reusable styled range + value chip.
- `frontend/src/components/Header.svelte`, `BoardControls.svelte`, `EngineHeader.svelte`, `EngineSettings.svelte`, `ViewMenu.svelte`, `MoveFeedback.svelte`, `MoveHistory.svelte`, `SourceControls.svelte`, `PositionControls.svelte`, `ActionBar.svelte`.

### Frontend (modify)
- `frontend/src/lib/types.ts` — new Command variants, `MoveEntryDto`, StateFrame fields.
- `frontend/src/app.css` — Editorial Slate theme (fonts + CSS variables + base).
- `frontend/index.html` — Google Fonts `<link>`.
- `frontend/src/components/EvalBar.svelte` — vertical bar + unsigned score.
- `frontend/src/components/Lines.svelte` — eval pill + figurine PV + expand chevron.
- `frontend/src/App.svelte` — new layout, compose sections, view-toggle state + persistence.

### Frontend (remove at the end)
- `frontend/src/components/Controls.svelte` + `frontend/src/tests/Controls.test.ts` (replaced by the section components).
- `frontend/src/components/LastMove.svelte` + `frontend/src/tests/LastMove.test.ts` (replaced by `MoveFeedback`).

Kept as-is: `Board.svelte` (chessground `brown` theme already matches the wood squares), `BoardBadge.svelte`, `MoveBadge.svelte`, `EditPalette.svelte`, `RegionOverlay.svelte`, and their libs/tests.

---

## Phase 1 — Backend foundation

Run backend tests with: `cd /home/buga/Dev/ChessMenthol && python -m pytest <path> -v`.
Existing fakes live in `tests/server/` and `tests/engine/` — read `tests/server/test_orchestrator.py` first to reuse its fake engine/session.

### Task 1.1: History model + truncating make_move

**Files:**
- Modify: `chessmenthol/server/orchestrator.py`
- Test: `tests/server/test_orchestrator.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/server/test_orchestrator.py` (reuse the module's existing orchestrator fixture/fake — match its construction style):

```python
def test_make_move_appends_history_entry(orch_and_frames):
    orch, frames = orch_and_frames  # adapt to the file's existing helper
    orch.handle({"type": "make_move", "uci": "e2e4"})
    f = frames[-1]
    assert f["moveList"] == [
        {"ply": 1, "san": "e4", "uci": "e2e4", "classification": None}
    ]
    assert f["currentPly"] == 1


def test_make_move_from_past_cursor_truncates_forward(orch_and_frames):
    orch, frames = orch_and_frames
    orch.handle({"type": "make_move", "uci": "e2e4"})
    orch.handle({"type": "make_move", "uci": "e7e5"})
    orch.handle({"type": "navigate", "index": 1})   # back to after 1.e4
    orch.handle({"type": "make_move", "uci": "c7c5"})  # branch: drops 1...e5
    f = frames[-1]
    assert [e["san"] for e in f["moveList"]] == ["e4", "c5"]
    assert f["currentPly"] == 2
```

If the file has no shared helper, construct the orchestrator with its existing fake engine + a frame-collecting `send` exactly as the surrounding tests do.

- [ ] **Step 2: Run to verify fail** — `python -m pytest tests/server/test_orchestrator.py -k history -v` → FAIL (`moveList` KeyError / `navigate` unknown).

- [ ] **Step 3: Implement**

At the top of `orchestrator.py`, add imports + dataclass:

```python
from dataclasses import dataclass, field
from ..analysis.classify import Classification

@dataclass
class HistoryEntry:
    move: chess.Move
    san: str
    classification: Optional[Classification] = None
    last_move: Optional[dict] = None
```

In `__init__`, after `self._board = chess.Board()` add:

```python
        self._base_fen = chess.STARTING_FEN
        self._history: list[HistoryEntry] = []
        self._cursor = 0
        self._analysis_enabled = True
        self._movetime: Optional[float] = 10.0  # seconds; None == infinite
```

Change `self._pending` typing to a 4-tuple (board_before, move, before_a, ply):

```python
        self._pending: Optional[Tuple[chess.Board, chess.Move, Optional[AnalysisInfo], int]] = None
```

Add helpers and rewrite `make_move`:

```python
    def _rebuild_board(self) -> None:
        board = chess.Board(self._base_fen)
        for entry in self._history[: self._cursor]:
            board.push(entry.move)
        self._board = board

    def _play_move(self, move: chess.Move, board_before: chess.Board,
                   before_a: Optional[AnalysisInfo]) -> None:
        san = board_before.san(move)
        del self._history[self._cursor :]          # truncate any forward line
        self._board = board_before.copy()
        self._board.push(move)
        self._history.append(HistoryEntry(move=move, san=san))
        self._cursor = len(self._history)
        self._last_analysis = None
        self._last_move = None
        self._pending = (board_before, move, before_a, self._cursor - 1)
        self._restart()

    def make_move(self, uci: str) -> None:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            self._error(f"invalid move: {uci!r}")
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        if move not in self._board.legal_moves:
            self._error(f"illegal move: {uci}")
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        self._session.stop()
        before = self._last_analysis
        board_before = self._board.copy()
        self._play_move(move, board_before, before)
```

(`navigate` lands in Task 1.2; `_state_frame` fields in Task 1.4 — implement those next so the suite goes green. It's fine for this test to stay red until 1.4.)

- [ ] **Step 4: Commit** (after 1.4 makes the suite green):
```bash
git add chessmenthol/server/orchestrator.py tests/server/test_orchestrator.py
git commit -m "feat(server): explicit move history with truncating make_move"
```

### Task 1.2: navigate + reset + fresh-line set_fen/set_turn

**Files:** Modify `chessmenthol/server/orchestrator.py`; Test `tests/server/test_orchestrator.py`.

- [ ] **Step 1: Write failing tests**

```python
def test_navigate_clamps_and_sets_cursor(orch_and_frames):
    orch, frames = orch_and_frames
    orch.handle({"type": "make_move", "uci": "e2e4"})
    orch.handle({"type": "make_move", "uci": "e7e5"})
    orch.handle({"type": "navigate", "index": 0})
    assert frames[-1]["currentPly"] == 0
    assert frames[-1]["fen"].startswith("rnbqkbnr/pppppppp")  # back at startpos
    orch.handle({"type": "navigate", "index": 99})            # clamps to tip
    assert frames[-1]["currentPly"] == 2


def test_reset_clears_history(orch_and_frames):
    orch, frames = orch_and_frames
    orch.handle({"type": "make_move", "uci": "e2e4"})
    orch.handle({"type": "reset"})
    assert frames[-1]["moveList"] == []
    assert frames[-1]["currentPly"] == 0
    assert frames[-1]["fen"].startswith("rnbqkbnr/pppppppp")


def test_set_fen_starts_fresh_line(orch_and_frames):
    orch, frames = orch_and_frames
    orch.handle({"type": "make_move", "uci": "e2e4"})
    orch.handle({"type": "set_fen", "fen": "8/8/8/4k3/8/4K3/8/8 w - - 0 1"})
    assert frames[-1]["moveList"] == []
    assert frames[-1]["currentPly"] == 0
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

Add dispatch in `handle()` (inside the `try`, alongside the other `elif`s):

```python
            elif ctype == "navigate":
                self.navigate(int(cmd["index"]))
            elif ctype == "reset":
                self.reset()
            elif ctype == "set_analysis_enabled":
                self.set_analysis_enabled(bool(cmd["enabled"]))
```

Add methods:

```python
    def navigate(self, index: int) -> None:
        self._session.stop()
        index = max(0, min(len(self._history), index))
        self._cursor = index
        self._rebuild_board()
        self._last_analysis = None
        self._pending = None
        self._pre_move_analysis = None
        self._last_move = self._history[index - 1].last_move if index > 0 else None
        self._restart()

    def reset(self) -> None:
        self._session.stop()
        self._base_fen = chess.STARTING_FEN
        self._history = []
        self._cursor = 0
        self._board = chess.Board()
        self._reset_move_state()
        self._restart()
```

Rewrite `_apply_fen` to start a fresh line (replace its body after validation):

```python
    def _apply_fen(self, fen: str) -> None:
        try:
            board = chess.Board(fen)
        except ValueError as exc:
            self._error(f"invalid FEN: {exc}")
            return
        if not board.is_valid():
            self._error("invalid position")
            return
        self._session.stop()
        self._base_fen = board.fen()
        self._history = []
        self._cursor = 0
        self._board = board
        self._reset_move_state()
        self._restart()
```

Rewrite `set_turn` to start a fresh line from the flipped current position:

```python
    def set_turn(self, white: bool) -> None:
        board = self._board.copy(stack=False)
        board.turn = chess.WHITE if white else chess.BLACK
        if not board.is_valid():
            self._error("turn change produces an invalid position")
            return
        self._session.stop()
        self._base_fen = board.fen()
        self._history = []
        self._cursor = 0
        self._board = board
        self._reset_move_state()
        self._restart()
        if self._tracker is not None:
            self._tracker.set_side_override(chess.WHITE if white else chess.BLACK)
```

Replace `undo` (history-aware, non-destructive prev — keeps forward for redo):

```python
    def undo(self) -> None:
        self.navigate(max(0, self._cursor - 1))
```

- [ ] **Step 4: Commit** (after 1.4): folded into Task 1.4's commit, or commit separately once green.

### Task 1.3: (folded) — covered by 1.2 dispatch additions. No standalone task.

### Task 1.4: Classify-into-history + state-frame fields

**Files:** Modify `chessmenthol/server/orchestrator.py`; Test `tests/server/test_orchestrator.py`.

- [ ] **Step 1: Write failing test**

Use the file's existing deep-analysis fake (the one that drives classification in current tests). Mirror the existing "last move classified" test, then assert the classification also lands in `moveList`:

```python
def test_classification_lands_in_move_list(deep_orch_and_frames):
    orch, frames = deep_orch_and_frames  # fake that emits depth >= CLASSIFY_MIN_DEPTH
    orch.handle({"type": "make_move", "uci": "e2e4"})
    entry = frames[-1]["moveList"][0]
    assert entry["classification"] is not None
    assert entry["classification"]["label"]  # e.g. "best"/"good"/...
    assert frames[-1]["lastMove"] is not None
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

Update `_on_update` to store into the pending ply (replace the classify block):

```python
    def _on_update(self, analysis: AnalysisInfo, board: chess.Board) -> None:
        self._last_analysis = analysis
        if (self._pending is not None and analysis.best is not None
                and analysis.best.move is not None
                and analysis.depth >= CLASSIFY_MIN_DEPTH):
            board_before, move, before_a, ply = self._pending
            if (before_a is not None and before_a.best is not None
                    and before_a.best.move is not None):
                c = classify_move(board_before, move, before_a, analysis)
                lm = serialize.last_move_to_dict(c, board_before, move, before_a, analysis)
                self._last_move = lm
                self._pre_move_analysis = before_a
                if 0 <= ply < len(self._history):
                    self._history[ply].classification = c
                    self._history[ply].last_move = lm
            self._pending = None
        self._send(self._state_frame(analysis, board))
```

Add the new fields to `_state_frame`'s returned dict (just before the closing `}`):

```python
            "moveList": [
                {
                    "ply": i + 1,
                    "san": e.san,
                    "uci": e.move.uci(),
                    "classification": (serialize.classification_to_dict(e.classification)
                                       if e.classification is not None else None),
                }
                for i, e in enumerate(self._history)
            ],
            "currentPly": self._cursor,
            "analysisEnabled": self._analysis_enabled,
            "movetime": None if self._movetime is None else int(self._movetime * 1000),
```

- [ ] **Step 4: Run all orchestrator tests** — `python -m pytest tests/server/test_orchestrator.py -v` → the Task 1.1/1.2/1.4 tests now PASS. Fix any existing test that asserted the exact `_state_frame` dict shape (add the new keys).

- [ ] **Step 5: Commit**
```bash
git add chessmenthol/server/orchestrator.py tests/server/test_orchestrator.py
git commit -m "feat(server): history navigation, reset, classify-into-history, move-list frame"
```

### Task 1.5: Movetime plumbing + true-infinite streaming

**Files:** Modify `chessmenthol/engine/manager.py`, `chessmenthol/server/orchestrator.py`, `chessmenthol/server/session.py`; Tests `tests/engine/test_manager_stream.py`, `tests/server/test_orchestrator.py`.

- [ ] **Step 1: Write failing tests**

In `tests/server/test_orchestrator.py` (use a fake session that records the `time_limit` it is started with — extend the file's fake session to capture `start(...)` kwargs):

```python
def test_set_options_movetime_passes_seconds_to_session(orch_and_fake_session):
    orch, fake = orch_and_fake_session
    orch.handle({"type": "set_options", "movetime": 5000})  # ms
    assert fake.last_start_kwargs["time_limit"] == 5.0

def test_set_options_movetime_infinite(orch_and_fake_session):
    orch, fake = orch_and_fake_session
    orch.handle({"type": "set_options", "movetime": None})
    assert fake.last_start_kwargs["time_limit"] is None
```

In `tests/engine/test_manager_stream.py` add (adapt to its existing fake engine that records the `Limit`):

```python
def test_stream_infinite_when_no_depth_or_time(stream_manager_and_fake):
    mgr, fake = stream_manager_and_fake
    mgr.stream_analysis(chess.Board())  # no depth, no time
    assert fake.last_limit.depth is None and fake.last_limit.time is None
```

If `test_manager_stream.py` has a test asserting a depth=18 default for streaming, update it to expect infinite (`depth is None`).

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

`manager.py` `stream_analysis` — drop the depth fallback so infinite is reachable:

```python
    def stream_analysis(self, board: chess.Board, *,
                        depth: Optional[int] = None,
                        time: Optional[float] = None,
                        multipv: Optional[int] = None) -> AnalysisStream:
        mpv = multipv if multipv is not None else self._multipv
        limit = chess.engine.Limit(depth=depth, time=time)
        result = self._require().analysis(board, limit, multipv=mpv)
        return AnalysisStream(result, board.fen())
```

`orchestrator.py` `set_options` — add movetime + pass to session via `_restart`. Add to `set_options` before `self._restart()`:

```python
        if "movetime" in cmd:
            mt = cmd["movetime"]
            self._movetime = None if mt in (None, 0) else float(mt) / 1000.0
```

Change `_restart`'s session start to pass the limit (and default `_depth` to None so movetime drives — set `self._depth: Optional[int] = None` in `__init__`):

```python
        self._session.start(self._board, depth=self._depth, multipv=self._multipv,
                            time_limit=self._movetime)
```

- [ ] **Step 4: Run** → PASS. Run `python -m pytest tests/engine -v` to confirm no regressions.

- [ ] **Step 5: Commit**
```bash
git add chessmenthol/engine/manager.py chessmenthol/server/orchestrator.py tests/
git commit -m "feat(engine): expose movetime; allow true-infinite streaming"
```

### Task 1.6: Analysis enabled gate

**Files:** Modify `chessmenthol/server/orchestrator.py`; Test `tests/server/test_orchestrator.py`.

- [ ] **Step 1: Write failing tests**

```python
def test_disable_analysis_stops_and_no_restart(orch_and_fake_session):
    orch, fake = orch_and_fake_session
    orch.handle({"type": "set_analysis_enabled", "enabled": False})
    assert orch_frame(orch)["analysisEnabled"] is False
    assert orch_frame(orch)["analyzing"] is False
    fake.start_calls = 0
    orch.handle({"type": "make_move", "uci": "e2e4"})  # must NOT start analysis
    assert fake.start_calls == 0

def test_enable_analysis_restarts(orch_and_fake_session):
    orch, fake = orch_and_fake_session
    orch.handle({"type": "set_analysis_enabled", "enabled": False})
    fake.start_calls = 0
    orch.handle({"type": "set_analysis_enabled", "enabled": True})
    assert fake.start_calls == 1
```

(`orch_frame` = helper returning the last frame; adapt to the file's pattern.)

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

```python
    def set_analysis_enabled(self, enabled: bool) -> None:
        self._analysis_enabled = enabled
        if enabled:
            self._restart()
        else:
            self._session.stop()
            self._analyzing = False
            self._send(self._state_frame(self._last_analysis, self._board))
```

Guard `_restart` (insert at the top):

```python
    def _restart(self) -> None:
        if not self._analysis_enabled:
            self._analyzing = False
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        # ... existing body unchanged ...
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(server): analysis on/off master switch`.

### Task 1.7: Finite-search "hold" (on_done)

**Files:** Modify `chessmenthol/server/session.py`, `chessmenthol/engine/manager.py`, `chessmenthol/server/orchestrator.py`; Tests `tests/server/test_session.py`, `tests/server/test_orchestrator.py`.

- [ ] **Step 1: Write failing tests**

`tests/server/test_session.py` (use its existing fake stream/engine; a fake stream that ends after N infos and exposes `stopped`):

```python
def test_on_done_fires_when_stream_ends_naturally(session_with_finite_stream):
    session, done_calls = session_with_finite_stream
    session.start(chess.Board(), time_limit=0.01)
    session.join()           # wait for the worker to finish the finite stream
    assert done_calls == [1] # on_done called once

def test_on_done_not_fired_when_stopped(session_with_blocking_stream):
    session, done_calls = session_with_blocking_stream
    session.start(chess.Board())
    session.stop()
    assert done_calls == []
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

`AnalysisStream` (manager.py) — expose stopped:

```python
    @property
    def stopped(self) -> bool:
        return self._stopped
```

`session.py` — accept + fire `on_done`:

```python
    def __init__(self, engine, on_update: UpdateCallback, *, on_done=None,
                 throttle: float = 0.1, monotonic=time.monotonic):
        # ... existing assignments ...
        self.on_done = on_done

    def _run(self, stream, board) -> None:
        last_emit = 0.0
        pending: Optional[AnalysisInfo] = None
        try:
            for info in stream:
                pending = info
                now = self._monotonic()
                if now - last_emit >= self._throttle:
                    self._on_update(info, board)
                    pending = None
                    last_emit = now
            if pending is not None:
                self._on_update(pending, board)
            if self.on_done is not None and not getattr(stream, "stopped", False):
                self.on_done()
        except Exception:
            logger.exception("analysis worker thread crashed")
```

`orchestrator.py` — wire it. After `self._session = factory(...)` in `__init__` add:

```python
        self._session.on_done = self._on_search_done
```

Add the handler:

```python
    def _on_search_done(self) -> None:
        # A finite search reached its limit: hold the last result, stop "analyzing".
        self._analyzing = False
        self._send(self._state_frame(self._last_analysis, self._board))
```

- [ ] **Step 4: Run** — `python -m pytest tests/server/test_session.py tests/server/test_orchestrator.py -v` → PASS.
- [ ] **Step 5: Commit** `feat(server): hold result when a finite search completes`.

### Task 1.8: play_best truncate semantics

**Files:** Modify `chessmenthol/server/orchestrator.py`; Test `tests/server/test_orchestrator.py`.

- [ ] **Step 1: Write failing test**

Adapt the file's existing `play_best` test (the one with retained deep analysis). After playing a sub-optimal move and invoking `play_best`, assert the move list ends with the best move and the played move is gone:

```python
def test_play_best_replaces_played_move_in_history(deep_orch_play_best):
    orch, frames, best_uci, best_san = deep_orch_play_best
    orch.handle({"type": "make_move", "uci": SUBOPTIMAL_UCI})
    orch.handle({"type": "play_best", "uci": best_uci})
    sans = [e["san"] for e in frames[-1]["moveList"]]
    assert sans[-1] == best_san
    assert SUBOPTIMAL_SAN not in sans
    assert frames[-1]["currentPly"] == len(sans)
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement** — rewrite `play_best`:

```python
    def play_best(self, uci: str) -> None:
        before = self._pre_move_analysis
        if before is None or before.best is None or self._cursor == 0:
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            self._error(f"invalid move: {uci!r}")
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        target = self._cursor - 1
        board_before = chess.Board(self._base_fen)
        for entry in self._history[:target]:
            board_before.push(entry.move)
        if move not in board_before.legal_moves:
            self._error(f"illegal best move: {uci}")
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        self._session.stop()
        self._cursor = target            # _play_move truncates from here (drops played move)
        self._play_move(move, board_before, before)
```

- [ ] **Step 4: Run** — `python -m pytest tests/server/ -v` → all PASS.
- [ ] **Step 5: Commit** `feat(server): play_best truncates and replays best into history`.

### Task 1.9: Backend regression sweep

- [ ] Run the full backend suite: `python -m pytest -q`. Fix any test that asserted the old `_state_frame` shape, the old `undo` (pop) semantics, or the streaming depth default. Commit `test(server): update fixtures for history-based orchestrator`.

---

## Phase 2 — Frontend protocol + theme + shell

Run frontend tests with: `cd /home/buga/Dev/ChessMenthol/frontend && npm test`. Type-check with `npm run check`.

### Task 2.1: Protocol types

**Files:** Modify `frontend/src/lib/types.ts`; Test `frontend/src/tests/ws.test.ts`.

- [ ] **Step 1: Write failing test** — add to `ws.test.ts`:

```ts
import { applyFrame, state } from '../lib/ws';
import { get } from 'svelte/store';

it('round-trips the new state-frame fields', () => {
  applyFrame({
    type: 'state', fen: 'startpos', sideToMove: 'white', engineId: 'stockfish',
    analyzing: false, eval: null, depth: 0, lines: [], lastMove: null,
    visionStatus: 'idle', detectedOrientation: null, lowConfidence: [], region: null,
    moveList: [{ ply: 1, san: 'e4', uci: 'e2e4', classification: null }],
    currentPly: 1, analysisEnabled: true, movetime: 5000,
  } as any);
  expect(get(state)!.moveList[0].san).toBe('e4');
  expect(get(state)!.currentPly).toBe(1);
});
```

- [ ] **Step 2: Run** → FAIL (type error / missing field).

- [ ] **Step 3: Implement** — in `types.ts` add the DTO + fields and commands:

```ts
export interface MoveEntryDto {
  ply: number; san: string; uci: string; classification: ClassificationDto | null;
}
```

Add to `StateFrame`:

```ts
  moveList: MoveEntryDto[];
  currentPly: number;
  analysisEnabled: boolean;
  movetime: number | null;
```

Add to the `Command` union:

```ts
  | { type: 'navigate'; index: number }
  | { type: 'reset' }
  | { type: 'set_analysis_enabled'; enabled: boolean }
```

And extend `set_options`:

```ts
  | { type: 'set_options'; depth?: number; multipv?: number; threads?: number;
      hash?: number; movetime?: number | null }
```

- [ ] **Step 4: Run** `npm test -- ws` and `npm run check` → PASS / clean.
- [ ] **Step 5: Commit** `feat(frontend): extend WS protocol types for history + new options`.

### Task 2.2: Editorial Slate theme

**Files:** Modify `frontend/index.html`, `frontend/src/app.css`.

- [ ] **Step 1: Implement** (no unit test — visual). In `index.html` `<head>`, add the exact fonts `<link>` from MOCKUP lines 7-9 (Fraunces / Hanken Grotesk / Space Mono). In `app.css`, replace the 2-line file with: the `:root` variable block from MOCKUP lines 11-20, plus `*{box-sizing}`, `html,body{margin:0}`, and the `body{ background/color/font/padding/background-image }` rules from MOCKUP lines 21-31, and `::selection` (line 32). Keep `--bsize` exactly as MOCKUP line 19.

- [ ] **Step 2: Verify** `npm run dev`, open the app — paper background + fonts load (layout still old; that's fine).
- [ ] **Step 3: Commit** `style(frontend): Editorial Slate theme tokens + fonts`.

### Task 2.3: Options maps

**Files:** Create `frontend/src/lib/options.ts`, `frontend/src/tests/options.test.ts`.

- [ ] **Step 1: Write failing test**:

```ts
import { SEARCH_TIMES, MEMORY_MB, searchLabel, memoryLabel } from '../lib/options';

it('maps search-time slider index to ms (null = infinite)', () => {
  expect(SEARCH_TIMES.map((s) => s.ms)).toEqual([2000, 5000, 10000, 20000, 30000, null]);
  expect(searchLabel(2)).toBe('10s');
  expect(searchLabel(5)).toBe('∞');
});

it('maps memory slider index to MB', () => {
  expect(MEMORY_MB).toEqual([16, 32, 64, 128, 256, 512]);
  expect(memoryLabel(4)).toBe('256MB');
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `options.ts`:

```ts
export interface SearchTime { ms: number | null; label: string; }
export const SEARCH_TIMES: SearchTime[] = [
  { ms: 2000, label: '2s' }, { ms: 5000, label: '5s' }, { ms: 10000, label: '10s' },
  { ms: 20000, label: '20s' }, { ms: 30000, label: '30s' }, { ms: null, label: '∞' },
];
export const MEMORY_MB = [16, 32, 64, 128, 256, 512];
export const DEFAULT_SEARCH_INDEX = 2;   // 10s, matches the mockup
export const DEFAULT_MEMORY_INDEX = 4;   // 256MB
export const searchLabel = (i: number) => SEARCH_TIMES[i].label;
export const memoryLabel = (i: number) => `${MEMORY_MB[i]}MB`;
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): search-time + memory option maps`.

### Task 2.4: Switch + RangeSlider primitives

**Files:** Create `frontend/src/components/Switch.svelte`, `RangeSlider.svelte`; Tests `frontend/src/tests/Switch.test.ts`, `RangeSlider.test.ts`.

- [ ] **Step 1: Write failing tests**:

`Switch.test.ts`:
```ts
import { render, fireEvent } from '@testing-library/svelte';
import Switch from '../components/Switch.svelte';

it('reflects on state and emits toggle', async () => {
  const onToggle = vi.fn();
  const { getByRole } = render(Switch, { props: { on: true, onToggle, label: 'X' } });
  const sw = getByRole('switch');
  expect(sw.getAttribute('aria-checked')).toBe('true');
  await fireEvent.click(sw);
  expect(onToggle).toHaveBeenCalled();
});
```

`RangeSlider.test.ts`:
```ts
import { render, fireEvent } from '@testing-library/svelte';
import RangeSlider from '../components/RangeSlider.svelte';

it('shows the label for the current index and emits on input', async () => {
  const onInput = vi.fn();
  const { getByRole, getByTestId } = render(RangeSlider, {
    props: { min: 0, max: 5, value: 2, labels: ['2s','5s','10s','20s','30s','∞'], onInput },
  });
  expect(getByTestId('range-value').textContent).toBe('10s');
  const input = getByRole('slider') as HTMLInputElement;
  input.value = '5';
  await fireEvent.input(input);
  expect(onInput).toHaveBeenCalledWith(5);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`Switch.svelte` — port the `.sw`/`.knob` styles from MOCKUP lines 174-179. Use `role="switch"`:
```svelte
<script lang="ts">
  export let on = false;
  export let onToggle: () => void = () => {};
  export let label = '';
</script>
<div class="sw" class:on role="switch" aria-checked={on} aria-label={label}
  tabindex="0" on:click={onToggle} on:keydown={(e) => e.key === 'Enter' && onToggle()}>
  <span class="knob"></span>
</div>
<style>/* port .sw and .sw .knob and .sw.on rules from MOCKUP 174-179 */</style>
```

`RangeSlider.svelte` — port `.rng` + `.v` styles from MOCKUP lines 193-200; replicate the `--fill` percentage logic from MOCKUP lines 419-423:
```svelte
<script lang="ts">
  export let min = 0; export let max = 5; export let value = 0; export let step = 1;
  export let labels: string[] | null = null;
  export let onInput: (v: number) => void = () => {};
  $: fill = ((value - min) / (max - min)) * 100;
  $: text = labels ? labels[value] : String(value);
  function handle(e: Event) { value = Number((e.target as HTMLInputElement).value); onInput(value); }
</script>
<input class="rng" type="range" {min} {max} {step} {value}
  style="--fill:{fill}%" role="slider" on:input={handle} />
<span class="v" data-testid="range-value">{text}</span>
<style>/* port .rng + .rng::-webkit-slider-thumb + .v from MOCKUP 193-200 */</style>
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): reusable Switch + RangeSlider`.

### Task 2.5: EvalBar redesign

**Files:** Modify `frontend/src/components/EvalBar.svelte`; Test `frontend/src/tests/EvalBar.test.ts`.

- [ ] **Step 1: Write failing test** — the score has NO +/- sign and the fill height = `whitePct`:

```ts
import { render } from '@testing-library/svelte';
import EvalBar from '../components/EvalBar.svelte';

it('renders an unsigned score and white-fill height', () => {
  const { getByTestId } = render(EvalBar, { props: { evalDto: { cp: 34, mate: null, text: '+0.34' } } });
  expect(getByTestId('eval-score').textContent).toBe('0.34');     // no '+'
  const fill = getByTestId('eval-fill') as HTMLElement;
  expect(parseFloat(fill.style.height)).toBeGreaterThan(50);       // white ahead
});

it('shows mate as M-notation, unsigned', () => {
  const { getByTestId } = render(EvalBar, { props: { evalDto: { cp: null, mate: -3, text: '#-3' } } });
  expect(getByTestId('eval-score').textContent).toBe('M3');
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — vertical bar from MOCKUP lines 57-64. Reuse `whitePct`:

```svelte
<script lang="ts">
  import type { EvalDto } from '../lib/types';
  import { whitePct } from '../lib/evalbar';
  export let evalDto: EvalDto | null = null;
  $: pct = whitePct(evalDto);
  $: score = format(evalDto);
  function format(ev: EvalDto | null): string {
    if (!ev) return '0.0';
    if (ev.mate != null) return `M${Math.abs(ev.mate)}`;
    return Math.abs((ev.cp ?? 0) / 100).toFixed(2);
  }
</script>
<div class="evalbar" data-testid="evalbar">
  <div class="fill" data-testid="eval-fill" style="height:{pct}%"></div>
  <div class="mid"></div>
  <span class="sc" data-testid="eval-score">{score}</span>
</div>
<style>/* port .evalbar, .fill, .mid, .sc from MOCKUP 57-64 */</style>
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): vertical eval bar with unsigned score`.

### Task 2.6: Header + BoardControls

**Files:** Create `frontend/src/components/Header.svelte`, `BoardControls.svelte`; Test `frontend/src/tests/BoardControls.test.ts`.

- [ ] **Step 1: Write failing test** (`BoardControls.test.ts`):

```ts
import { render, fireEvent } from '@testing-library/svelte';
import BoardControls from '../components/BoardControls.svelte';

it('emits turn + flip', async () => {
  const onSetTurn = vi.fn(); const onFlip = vi.fn();
  const { getByText, getByTestId } = render(BoardControls, {
    props: { sideToMove: 'white', onSetTurn, onFlip } });
  await fireEvent.click(getByText('Black'));
  expect(onSetTurn).toHaveBeenCalledWith(false);
  await fireEvent.click(getByTestId('flip-btn'));
  expect(onFlip).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`Header.svelte` — brand + kicker from MOCKUP lines 246-250 (drop the spacer/pill):
```svelte
<header>
  <div class="brand"><span class="mk">&#9822;</span><h1>Chess<i>Menthol</i></h1></div>
  <span class="kicker">Chess&nbsp;Analysis</span>
</header>
<style>/* port header/.brand/.kicker from MOCKUP 36-44 */</style>
```

`BoardControls.svelte` — turn segment + flip from MOCKUP lines 258-266 + the flip SVG (line 264); behavior from MOCKUP lines 404-406:
```svelte
<script lang="ts">
  export let sideToMove: 'white' | 'black' = 'white';
  export let onSetTurn: (white: boolean) => void = () => {};
  export let onFlip: () => void = () => {};
</script>
<div class="board-controls">
  <div class="seg" data-testid="turn-seg">
    <button class:on={sideToMove === 'white'} data-turn="w"
      on:click={() => onSetTurn(true)}><span class="disc"></span>White</button>
    <button class:on={sideToMove === 'black'} data-turn="b"
      on:click={() => onSetTurn(false)}><span class="disc"></span>Black</button>
  </div>
  <button class="icobtn" data-testid="flip-btn" title="Flip board" on:click={onFlip}>
    <!-- paste the flip <svg> verbatim from MOCKUP line 264 -->
  </button>
</div>
<style>/* port .board-controls/.seg/.icobtn from MOCKUP 66, 214-225 */</style>
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): Header + under-board turn/flip controls`.

### Task 2.7: App layout shell

**Files:** Modify `frontend/src/App.svelte`; Test `frontend/src/tests/smoke.test.ts`.

- [ ] **Step 1: Implement the shell** — restructure App's markup to the mockup skeleton (MOCKUP lines 245-374) using a placeholder card body for now: `<div class="app">` → `<Header/>` then `<main>` with `.board-col` (`{#if showEvalBar}<EvalBar/>{/if}` + `.board-wrap` containing `<Board/>` + `<BoardControls/>`) and `.panel > section.card` (empty sections to fill in Phase 3). Port the `.app`, `main`, `.board-col`, `.evalbar` spacing, `.panel`, `.card`, `.board-wrap` CSS from MOCKUP lines 33, 53-90. Wire `sideToMove`, `onSetTurn={(w)=>send({type:'set_turn',white:w})}`, `onFlip`.

- [ ] **Step 2: Run** `npm test -- smoke` and `npm run check`. Update `smoke.test.ts` if it asserts old header text. Expected: mounts without error.
- [ ] **Step 3: Commit** `feat(frontend): Editorial Slate layout shell`.

---

## Phase 3 — Card sections

### Task 3.1: EngineHeader + EngineSettings + ViewMenu

**Files:** Create `EngineHeader.svelte`, `EngineSettings.svelte`, `ViewMenu.svelte`; Tests `EngineSettings.test.ts`, `EngineHeader.test.ts`.

- [ ] **Step 1: Write failing tests** (`EngineSettings.test.ts`):

```ts
import { render, fireEvent } from '@testing-library/svelte';
import EngineSettings from '../components/EngineSettings.svelte';

it('emits set_options for lines / threads / memory / movetime', async () => {
  const onCommand = vi.fn();
  const { getAllByRole, getByDisplayValue } = render(EngineSettings, {
    props: { engineId: 'stockfish', onCommand, onSetEngine: vi.fn() } });
  const sliders = getAllByRole('slider') as HTMLInputElement[]; // [Lines, SearchTime, Threads, Memory]
  sliders[0].value = '4'; await fireEvent.input(sliders[0]);
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', multipv: 4 });
  sliders[1].value = '5'; await fireEvent.input(sliders[1]); // ∞
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', movetime: null });
  sliders[3].value = '5'; await fireEvent.input(sliders[3]); // 512MB
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', hash: 512 });
});
```

`EngineHeader.test.ts`:
```ts
it('emits set_analysis_enabled when the Analysis switch is toggled', async () => {
  const onCommand = vi.fn();
  const { getByRole } = render(EngineHeader, {
    props: { analysisEnabled: true, analyzing: true, depth: 24, engineId: 'stockfish',
      onCommand, /* popover + view-toggle props */ } });
  await fireEvent.click(getByRole('switch'));
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_analysis_enabled', enabled: false });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`EngineSettings.svelte` (cog popover, MOCKUP lines 281-288) — engine `<select>` + 4 `RangeSlider`s. Use `SEARCH_TIMES`/`MEMORY_MB` from `options.ts`. Each slider's `onInput(index)` maps to a command:
```svelte
<script lang="ts">
  import RangeSlider from './RangeSlider.svelte';
  import { SEARCH_TIMES, MEMORY_MB } from '../lib/options';
  import type { Command } from '../lib/types';
  export let engineId = 'stockfish';
  export let onCommand: (c: Command) => void = () => {};
  export let onSetEngine: (id: string) => void = () => {};
  const ENGINES = [{ id: 'stockfish', label: 'Stockfish 16' },
                   { id: 'stockfish_lite', label: 'Stockfish Lite' }];
  let lines = 3, search = 2, threads = 4, mem = 4;  // mockup defaults
</script>
<!-- markup: .settings popover; one .set-row per control; port styles from MOCKUP 182-200 -->
<!-- Lines:   onInput={(v)=>{lines=v; onCommand({type:'set_options', multipv:v})}} -->
<!-- Search:  labels from SEARCH_TIMES; onInput={(v)=>{search=v; onCommand({type:'set_options', movetime: SEARCH_TIMES[v].ms})}} -->
<!-- Threads: min=2 max=32; onInput={(v)=>{threads=v; onCommand({type:'set_options', threads:v})}} -->
<!-- Memory:  labels=MEMORY_MB.map(m=>m+'MB'); onInput={(v)=>{mem=v; onCommand({type:'set_options', hash: MEMORY_MB[v]})}} -->
```

`ViewMenu.svelte` (MOCKUP lines 289-294) — 4 `Switch`es bound to view-toggle props/callbacks (Evaluation Bar / Engine Lines / Suggestion Arrows / Move Feedback).

`EngineHeader.svelte` (MOCKUP lines 274-295) — Analysis `Switch` (`onToggle` → `onCommand({type:'set_analysis_enabled', enabled: !analysisEnabled})`), the `depth NN | <engineLabel>` tag, cog + menu buttons (toggle popover open state via props/callbacks), and slot/embed `EngineSettings` + `ViewMenu`. Map `engineId`→label with the same `ENGINES` lookup (extract to `options.ts` if shared).

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): engine header with settings + view-menu popovers`.

### Task 3.2: Lines redesign

**Files:** Modify `frontend/src/components/Lines.svelte`; Test `frontend/src/tests/Lines.test.ts`.

- [ ] **Step 1: Write failing test**:

```ts
import { render, fireEvent } from '@testing-library/svelte';
import Lines from '../components/Lines.svelte';

const line = (mpv: number, cp: number, san: string) =>
  ({ multipv: mpv, scoreText: cp >= 0 ? `+${(cp/100).toFixed(2)}` : (cp/100).toFixed(2),
     cp, mate: null, pv: [], san });

it('keeps the +/- sign and toggles open on expand', async () => {
  const { getAllByTestId, getAllByTitle } = render(Lines, {
    props: { lines: [line(1, 34, '1.e4 e5'), line(2, -7, '1.c4 e5')] } });
  const rows = getAllByTestId('line-row');
  expect(rows[0].textContent).toContain('+0.34');
  expect(rows[1].className).toContain('neg');
  await fireEvent.click(getAllByTitle('Show full line')[0]);
  expect(rows[0].className).toContain('open');
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — port `.line`/`.sc`/`.pv`/`.lexp` markup + the two chevron SVGs from MOCKUP lines 100-116, 297-299. Per-row `open` state in a local `Set<number>`. `pos`/`neg` class from `line.cp` sign (mate>0 ⇒ pos). PV via `toFigurine(line.san)`.

```svelte
<script lang="ts">
  import type { LineDto } from '../lib/types';
  import { toFigurine } from '../lib/figurine';
  export let lines: LineDto[] = [];
  let open = new Set<number>();
  const toggle = (mpv: number) => { open.has(mpv) ? open.delete(mpv) : open.add(mpv); open = open; };
  const sign = (l: LineDto) => (l.mate != null ? l.mate > 0 : (l.cp ?? 0) >= 0);
</script>
{#each lines as l (l.multipv)}
  <div class="line {sign(l) ? 'pos' : 'neg'}" class:open={open.has(l.multipv)} data-testid="line-row">
    <span class="sc">{l.scoreText}</span>
    <span class="pv">{toFigurine(l.san)}</span>
    <button class="lexp" title={open.has(l.multipv) ? 'Collapse line' : 'Show full line'}
      on:click={() => toggle(l.multipv)}><!-- chevron SVGs from MOCKUP 297 --></button>
  </div>
{/each}
<style>/* port .line family from MOCKUP 99-116 */</style>
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): engine-line rows with eval pill + expand`.

### Task 3.3: MoveFeedback (replaces LastMove)

**Files:** Create `frontend/src/components/MoveFeedback.svelte`, `frontend/src/tests/MoveFeedback.test.ts`. Remove `LastMove.svelte` + `LastMove.test.ts` in Task 4.4.

- [ ] **Step 1: Write failing test** — same data contract as `LastMove` (a `LastMoveDto`), chess.com row markup:

```ts
import { render, fireEvent } from '@testing-library/svelte';
import MoveFeedback from '../components/MoveFeedback.svelte';

const dto = {
  classification: { label: 'mistake', cpl: 276, isBest: false },
  played: { san: 'Nc3', uci: 'b1c3', evalText: '+5.03', pv: '16. Nxc3' },
  best: { san: 'Nec5', uci: 'd7c5', evalText: '+2.27', pv: '16. O-O-O' },
};

it('shows played + best rows and plays best on click', async () => {
  const onPlayBest = vi.fn();
  const { getByTestId, getByText } = render(MoveFeedback, { props: { lastMove: dto, onPlayBest } });
  expect(getByText(/is a mistake/)).toBeTruthy();
  await fireEvent.click(getByTestId('play-best'));
  expect(onPlayBest).toHaveBeenCalledWith('d7c5');
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — port the `.lm`/`.mrow`/`.badge`/`.cico`/`.mtext` markup from MOCKUP lines 304-321; reuse the `PHRASE`/`phraseFor` logic and the `badge wadv/badv` sign-class (from the played eval sign) and the `cico` class per label. Keep the `LastMoveDto` prop + `onPlayBest` from the old `LastMove.svelte` (lines 6-20). The best row is a `<button data-testid="play-best">`.

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): chess.com-style move feedback rows`.

### Task 3.4: MoveHistory

**Files:** Create `frontend/src/lib/moveclass.ts`, `frontend/src/components/MoveHistory.svelte`; Tests `frontend/src/tests/moveclass.test.ts`, `MoveHistory.test.ts`.

- [ ] **Step 1: Write failing tests**

`moveclass.test.ts`:
```ts
import { moveClass } from '../lib/moveclass';
it('maps labels to list CSS classes', () => {
  expect(moveClass({ label: 'blunder', cpl: 0, isBest: false })).toBe('blun');
  expect(moveClass({ label: 'mistake', cpl: 0, isBest: false })).toBe('mist');
  expect(moveClass({ label: 'good', cpl: 0, isBest: false })).toBe('good');
  expect(moveClass({ label: 'best', cpl: 0, isBest: true })).toBe('best');
  expect(moveClass(null)).toBe('');
});
```

`MoveHistory.test.ts`:
```ts
import { render, fireEvent } from '@testing-library/svelte';
import MoveHistory from '../components/MoveHistory.svelte';

const ml = [
  { ply: 1, san: 'd4', uci: 'd2d4', classification: null },
  { ply: 2, san: 'Nf6', uci: 'g8f6', classification: null },
  { ply: 3, san: 'c4', uci: 'c2c4', classification: { label: 'mistake', cpl: 0, isBest: false } },
];

it('renders two columns, figurines, highlights current, navigates on click', async () => {
  const onNavigate = vi.fn();
  const { getByText, getAllByTestId } = render(MoveHistory, {
    props: { moveList: ml, currentPly: 3, onNavigate } });
  expect(getByText('♞f6')).toBeTruthy();                 // figurine
  const cur = getAllByTestId('mh-mv').find((b) => b.classList.contains('current'))!;
  expect(cur.textContent).toContain('c4');
  await fireEvent.click(getByText('d4'));
  expect(onNavigate).toHaveBeenCalledWith(1);             // navigate to ply 1
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`moveclass.ts`:
```ts
import type { ClassificationDto } from './types';
const MAP: Record<string, string> = {
  blunder: 'blun', mistake: 'mist', inaccuracy: 'inacc',
  good: 'good', excellent: 'good', best: 'best', great: 'best',
  brilliant: 'brill', book: '', miss: 'mist',
};
export function moveClass(c: ClassificationDto | null): string {
  return c ? (MAP[c.label] ?? '') : '';
}
```

`MoveHistory.svelte` — group `moveList` into rows of `{no, white?, black?}` (ply 1,2 → row 1). Each move is a `<button class="mh-mv {moveClass} current?" data-testid="mh-mv">{toFigurine(san)}</button>` → `onNavigate(ply)`. Highlight when `ply === currentPly`. Port `.movehist`/`.mh-row`/`.mh-no`/`.mh-mv` styles from MOCKUP lines 226-239; the `min-height:180px` on the `.movehist-sec` parent (MOCKUP line 227) is essential. `scrollIntoView({block:'nearest'})` the current move on change (mirror MOCKUP line 431).

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): navigable move-history list`.

### Task 3.5: SourceControls (region-gated)

**Files:** Create `frontend/src/components/SourceControls.svelte`, `frontend/src/tests/SourceControls.test.ts`.

- [ ] **Step 1: Write failing test**:

```ts
import { render, fireEvent } from '@testing-library/svelte';
import SourceControls from '../components/SourceControls.svelte';

it('disables Capture until a region is set; shows Board Undetected', () => {
  const { getByText } = render(SourceControls, {
    props: { region: null, visionStatus: 'no_board', onCommand: vi.fn(),
      onPickRegion: vi.fn() } });
  expect((getByText('Capture Board') as HTMLButtonElement).disabled).toBe(true);
  expect(getByText('Board Undetected')).toBeTruthy();
});

it('enables Capture and emits capture_now when a region exists', async () => {
  const onCommand = vi.fn();
  const { getByText } = render(SourceControls, {
    props: { region: { left:0, top:0, width:10, height:10 }, visionStatus: 'found',
      onCommand, onPickRegion: vi.fn() } });
  const btn = getByText('Capture Board') as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
  await fireEvent.click(btn);
  expect(onCommand).toHaveBeenCalledWith({ type: 'capture_now' });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — markup from MOCKUP lines 346-353. `disabled={region == null}` on Capture. Status text: `no_board` → "Board Undetected", `low_confidence` → `${lowConfidence.length} uncertain`, else "". Buttons: Capture → `onCommand({type:'capture_now'})`; Select Region → `onPickRegion()`; Clear Selection → `onCommand({type:'clear_region'})`.

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): region-gated capture controls`.

### Task 3.6: PositionControls

**Files:** Create `frontend/src/components/PositionControls.svelte`, `frontend/src/tests/PositionControls.test.ts`.

- [ ] **Step 1: Write failing test**:

```ts
import { render, fireEvent } from '@testing-library/svelte';
import PositionControls from '../components/PositionControls.svelte';

it('sets FEN, resets, and toggles edit', async () => {
  const onCommand = vi.fn(); const onToggleEdit = vi.fn();
  const { getByPlaceholderText, getByText } = render(PositionControls, {
    props: { editing: false, onCommand, onToggleEdit } });
  await fireEvent.input(getByPlaceholderText('paste FEN…'), { target: { value: '8/8/8/8/8/8/8/8 w - - 0 1' } });
  await fireEvent.click(getByText('Set'));
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_fen', fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
  await fireEvent.click(getByText('Reset Board'));
  expect(onCommand).toHaveBeenCalledWith({ type: 'reset' });
  await fireEvent.click(getByText('Edit Board'));
  expect(onToggleEdit).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — markup from MOCKUP lines 355-364. FEN input bound to `fenInput`; Set → `onCommand({type:'set_fen', fen:fenInput})`; Edit Board → `onToggleEdit()` (label `editing ? 'Done' : 'Edit Board'`); Reset Board → `onCommand({type:'reset'})`.

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): position controls with reset`.

### Task 3.7: ActionBar

**Files:** Create `frontend/src/components/ActionBar.svelte`, `frontend/src/tests/ActionBar.test.ts`.

- [ ] **Step 1: Write failing test**:

```ts
import { render, fireEvent } from '@testing-library/svelte';
import ActionBar from '../components/ActionBar.svelte';

it('navigates first/prev/next/last relative to currentPly', async () => {
  const onNavigate = vi.fn();
  const { getByTitle } = render(ActionBar, { props: { currentPly: 3, total: 5, onNavigate } });
  await fireEvent.click(getByTitle('First move')); expect(onNavigate).toHaveBeenCalledWith(0);
  await fireEvent.click(getByTitle('Previous move')); expect(onNavigate).toHaveBeenCalledWith(2);
  await fireEvent.click(getByTitle('Next move')); expect(onNavigate).toHaveBeenCalledWith(4);
  await fireEvent.click(getByTitle('Last move')); expect(onNavigate).toHaveBeenCalledWith(5);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — markup from MOCKUP lines 366-371. `« ‹ › »` → `onNavigate(0)` / `onNavigate(currentPly-1)` / `onNavigate(currentPly+1)` / `onNavigate(total)`. Port `.actions`/`.navbtn` styles from MOCKUP lines 209-213.

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): history navigation action bar`.

---

## Phase 4 — Cross-cutting + integration + polish

### Task 4.1: View toggles + persistence

**Files:** Create `frontend/src/lib/viewprefs.ts`, `frontend/src/tests/viewprefs.test.ts`.

- [ ] **Step 1: Write failing test**:

```ts
import { loadViewPrefs, saveViewPrefs, DEFAULT_VIEW_PREFS } from '../lib/viewprefs';

it('round-trips view prefs through localStorage', () => {
  localStorage.clear();
  expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
  saveViewPrefs({ ...DEFAULT_VIEW_PREFS, evalBar: false });
  expect(loadViewPrefs().evalBar).toBe(false);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `viewprefs.ts`:

```ts
export interface ViewPrefs { evalBar: boolean; lines: boolean; arrows: boolean; feedback: boolean; }
export const DEFAULT_VIEW_PREFS: ViewPrefs =
  { evalBar: true, lines: true, arrows: true, feedback: true };
const KEY = 'chessmenthol.viewPrefs';
export function loadViewPrefs(): ViewPrefs {
  try { return { ...DEFAULT_VIEW_PREFS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULT_VIEW_PREFS }; }
}
export function saveViewPrefs(p: ViewPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): persist view toggles`.

### Task 4.2: Popover open/close behavior

**Files:** Modify `frontend/src/components/EngineHeader.svelte`; Test `frontend/src/tests/EngineHeader.test.ts`.

- [ ] **Step 1: Write failing test** — clicking the cog opens settings + closes the view menu; a document click closes both (mirror MOCKUP lines 409-416):

```ts
it('cog opens settings and closes the view menu; outside click closes both', async () => {
  const { getByLabelText, container } = render(EngineHeader, { props: { /* ...required props... */ } });
  await fireEvent.click(getByLabelText('Engine settings'));
  expect(container.querySelector('.settings.open')).toBeTruthy();
  await fireEvent.click(getByLabelText('View options'));
  expect(container.querySelector('.settings:not(.menu).open')).toBeFalsy();
  await fireEvent.click(document.body);
  expect(container.querySelector('.settings.open')).toBeFalsy();
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — local `open: 'cog' | 'menu' | null`; cog/menu buttons set it (toggle/switch). Add `on:click|stopPropagation` on the popovers and an `on:click` document listener via `svelte/legacy` `onMount(() => { const h = () => open = null; document.addEventListener('click', h); return () => document.removeEventListener('click', h); })`; cog/menu button handlers call `stopPropagation`. Port `.settings`/`.settings.open`/`.cog` styles from MOCKUP lines 182-206.

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): popover open/close + outside-click`.

### Task 4.3: Compose everything in App.svelte

**Files:** Modify `frontend/src/App.svelte`; Test `frontend/src/tests/App.*`/`smoke.test.ts`.

- [ ] **Step 1: Implement** — fill the card sections (Phase-3 components) inside the shell from Task 2.7, threading the new state fields and commands:
  - `EngineHeader` ← `analysisEnabled={s?.analysisEnabled}`, `analyzing`, `depth`, `engineId`, `onCommand=send`, view-pref props/handlers, `onSetEngine=(id)=>send({type:'set_engine',id})`.
  - `{#if viewPrefs.lines}<Lines lines={s?.lines ?? []} />{/if}`
  - `{#if viewPrefs.feedback}<MoveFeedback lastMove={s?.lastMove ?? null} onPlayBest={(uci)=>send({type:'play_best',uci})} />{/if}`
  - `<MoveHistory moveList={s?.moveList ?? []} currentPly={s?.currentPly ?? 0} onNavigate={(i)=>send({type:'navigate',index:i})} />`
  - `<SourceControls region={s?.region ?? null} visionStatus={...} lowConfidence={...} onCommand={send} onPickRegion={onPickRegion} />`
  - `<PositionControls editing={editing} onCommand={send} onToggleEdit={onToggleEdit} />`
  - `<ActionBar currentPly={s?.currentPly ?? 0} total={s?.moveList?.length ?? 0} onNavigate={(i)=>send({type:'navigate',index:i})} />`
  - `{#if viewPrefs.evalBar}<EvalBar .../>{/if}`; pass `showArrows={viewPrefs.arrows}` into `<Board/>`.
  - Hold `viewPrefs` via `loadViewPrefs()`; each toggle updates the object + `saveViewPrefs`. Keep the existing edit-commit logic (App lines 41-73) intact.

- [ ] **Step 2: Run** `npm test` and `npm run check`. Update `App`/`smoke` tests to the new structure. Expected: green.
- [ ] **Step 3: Commit** `feat(frontend): assemble Editorial Slate analysis card`.

### Task 4.4: Remove old components + final sweep

**Files:** Delete `Controls.svelte`, `Controls.test.ts`, `LastMove.svelte`, `LastMove.test.ts`.

- [ ] **Step 1:** Confirm nothing imports `Controls`/`LastMove` (`grep -rn "Controls\|LastMove" frontend/src`), then delete the four files.
- [ ] **Step 2:** Run the full frontend suite `npm test` + `npm run check`, and the full backend suite `python -m pytest -q`. All green.
- [ ] **Step 3:** Manual visual fidelity pass: `npm run dev`, compare against MOCKUP — board sizing (`--bsize`), card section dividers, popovers, move-list scrolling, nav, region-gating, search-time/analysis switch. Tune CSS to match.
- [ ] **Step 4: Commit** `chore(frontend): remove superseded Controls + LastMove`.

---

## Self-Review notes

- **Spec coverage:** linear history (1.1), navigate/redo (1.2, 3.4, 3.7), reset (1.2, 3.6), classify-on-play (1.4, 3.4), feedback (3.3), analysis switch (1.6, 3.1), search-time ∞/hold (1.5, 1.7, 3.1), memory/threads/lines (1.5, 3.1), view toggles (4.1, 4.3), region-gated capture (3.5), theme + components (2.x, 3.x), retired destructive undo (1.2). All spec sections map to a task.
- **Type consistency:** `MoveEntryDto` (ply/san/uci/classification) is defined once (2.1) and consumed identically in 3.4/4.3; `onCommand`/`onNavigate`/`onSetTurn` callback names are stable across components; backend `_pending` is a 4-tuple everywhere after 1.1.
- **Movetime units:** frontend sends **ms** (`SEARCH_TIMES[i].ms`); backend converts ms→seconds in `set_options` and ms back out in the frame. Consistent.
- **No placeholders:** visual CSS/markup is referenced to exact committed MOCKUP line ranges (DRY); all logic + tests are shown in full.
