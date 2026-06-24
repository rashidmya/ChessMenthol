# Milestone 2a — Backend Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the FastAPI + WebSocket backend that turns the M1 engine core into a live, streamable analysis service: incremental engine streaming, JSON serialization, a command orchestrator (with last-move classification), the WebSocket endpoint, and the desktop launcher entry points.

**Architecture:** Extend `EngineManager` with a cancellable `stream_analysis` that yields `AnalysisInfo` snapshots. A threaded `AnalysisSession` runs it and pushes throttled updates to a callback. An `Orchestrator` owns the working board + settings + session and turns WebSocket commands into state frames. A FastAPI `/ws` endpoint bridges the background analysis thread to the async socket via `run_coroutine_threadsafe`. Launcher entry points run uvicorn (and optionally a pywebview window).

**Tech Stack:** Python 3.11+, python-chess, FastAPI, uvicorn[standard], httpx (test client), pywebview (optional desktop extra), pytest.

---

## Prerequisites

The M1 milestone is on `main` with a venv at `.venv` and a bundled Stockfish at `chessmenthol/engines/stockfish/stockfish`. Work on a branch `milestone-2-web-ui` (already created if you committed the M2 spec; otherwise `git checkout -b milestone-2-web-ui`). Engine-marked tests use the bundled Stockfish.

## File Structure

```
chessmenthol/
  engine/
    manager.py          # MODIFY: add AnalysisStream + EngineManager.stream_analysis
  server/
    __init__.py         # new (empty)
    serialize.py        # new: AnalysisInfo/Eval/Line/Classification -> JSON dicts
    session.py          # new: AnalysisSession (threaded, throttled, cancellable)
    orchestrator.py     # new: Orchestrator (command state machine + classification)
    app.py              # new: FastAPI create_app() + /ws + static serving
    launcher.py         # new: run_server() and run_app() entry points
tests/
  server/
    __init__.py         # new (empty)
    test_serialize.py
    test_session.py
    test_orchestrator.py
    test_app.py
  engine/
    test_manager_stream.py   # new: engine-marked streaming tests
pyproject.toml          # MODIFY: deps + entry points
```

Each server file has one responsibility: `serialize` is pure data shaping; `session` is the threading/throttle concern; `orchestrator` is the command/state logic; `app` is the transport; `launcher` is process startup. They are tested independently with fakes.

---

### Task 1: Server dependencies + entry points

**Files:**
- Modify: `pyproject.toml`
- Create: `chessmenthol/server/__init__.py` (empty), `tests/server/__init__.py` (empty)

- [ ] **Step 1: Update `pyproject.toml`**

Replace the `dependencies`, `optional-dependencies`, and `scripts` sections so they read exactly:
```toml
dependencies = ["chess>=1.11", "fastapi>=0.110", "uvicorn[standard]>=0.29"]

[project.optional-dependencies]
dev = ["pytest>=8", "httpx>=0.27"]
desktop = ["pywebview>=5"]

[project.scripts]
chessmenthol-analyze = "chessmenthol.cli:main"
chessmenthol-server = "chessmenthol.server.launcher:run_server"
chessmenthol-app = "chessmenthol.server.launcher:run_app"
```
(Leave the rest of `pyproject.toml` — `[project]` name/version, build-system, packages.find, pytest markers — unchanged. `pywebview` is intentionally an optional `desktop` extra so the core install and tests never require system webview libraries.)

- [ ] **Step 2: Create the empty package files**

Create empty files: `chessmenthol/server/__init__.py` and `tests/server/__init__.py`.

- [ ] **Step 3: Install the new dependencies**

Run:
```bash
cd /home/buga/Dev/ChessMenthol
.venv/bin/pip install -e ".[dev]"
```
Expected: installs `fastapi`, `uvicorn`, `httpx` without error. (Do NOT install the `desktop` extra — pywebview needs system libs and is not needed for tests.)

- [ ] **Step 4: Verify the suite still passes**

Run: `.venv/bin/pytest -q`
Expected: the existing 57 tests pass (no new tests yet).

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml chessmenthol/server/__init__.py tests/server/__init__.py
git commit -m "chore(server): add FastAPI/uvicorn deps and server entry points"
```
(End every commit message in this plan with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 2: Engine streaming primitive

**Files:**
- Modify: `chessmenthol/engine/manager.py`
- Create: `tests/engine/test_manager_stream.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/engine/test_manager_stream.py
import chess
import pytest

from chessmenthol.engine.manager import EngineManager
from chessmenthol.engine.types import AnalysisInfo


@pytest.mark.engine
def test_stream_analysis_yields_snapshots_then_stops():
    with EngineManager() as em:
        em.select("stockfish")
        stream = em.stream_analysis(chess.Board(), depth=12, multipv=2)
        snapshots = []
        for info in stream:
            snapshots.append(info)
            if len(snapshots) >= 2:
                stream.stop()
                break
    assert len(snapshots) >= 1
    assert all(isinstance(s, AnalysisInfo) for s in snapshots)
    assert snapshots[-1].best is not None
    # depth never goes backwards across snapshots
    depths = [s.depth for s in snapshots]
    assert depths[-1] >= depths[0]


@pytest.mark.engine
def test_stream_analysis_context_manager_stops_on_exit():
    with EngineManager() as em:
        em.select("stockfish")
        with em.stream_analysis(chess.Board(), depth=10, multipv=1) as stream:
            first = next(iter(stream))
    assert first.best is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/engine/test_manager_stream.py -q`
Expected: FAIL — `AttributeError: 'EngineManager' object has no attribute 'stream_analysis'`

- [ ] **Step 3: Implement (append to `chessmenthol/engine/manager.py`)**

Add this class at the end of the file, and the `stream_analysis` method inside `EngineManager` (place the method right after `analyze`):
```python
# --- add this method inside class EngineManager, after analyze() ---
    def stream_analysis(self, board: chess.Board, *,
                        depth: Optional[int] = None,
                        time: Optional[float] = None,
                        multipv: Optional[int] = None) -> "AnalysisStream":
        mpv = multipv if multipv is not None else self._multipv
        if depth is None and time is None:
            depth = 18
        limit = chess.engine.Limit(depth=depth, time=time)
        result = self._require().analysis(board, limit, multipv=mpv)
        return AnalysisStream(result, board.fen())
```
```python
# --- add this class at module top-level, at the end of manager.py ---
class AnalysisStream:
    """Iterable of AnalysisInfo snapshots from a running multi-PV search.

    Iterating blocks until the next engine update; each yield rebuilds an
    AnalysisInfo from the handle's latest per-line info. stop() cancels the
    search; usable as a context manager (exit stops it).
    """

    def __init__(self, result: "chess.engine.SimpleAnalysisResult", fen: str):
        self._result = result
        self._fen = fen

    def __iter__(self):
        for _update in self._result:
            yield AnalysisInfo.from_engine(self._fen, list(self._result.multipv))

    def stop(self) -> None:
        self._result.stop()

    def __enter__(self) -> "AnalysisStream":
        return self

    def __exit__(self, *exc) -> None:
        self._result.stop()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/engine/test_manager_stream.py -q`
Expected: PASS (2 passed, or skipped if Stockfish absent)

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/pytest -q`
Expected: no failures.

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/engine/manager.py tests/engine/test_manager_stream.py
git commit -m "feat(engine): add cancellable streaming analysis (AnalysisStream)"
```

---

### Task 3: Serialization DTOs

**Files:**
- Create: `chessmenthol/server/serialize.py`
- Create: `tests/server/test_serialize.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/server/test_serialize.py
import chess

from chessmenthol.analysis.classify import Classification, MoveClass
from chessmenthol.engine.types import AnalysisInfo, Eval, Line
from chessmenthol.server.serialize import (
    analysis_to_dict,
    classification_to_dict,
    eval_to_dict,
    line_to_dict,
)


def test_eval_to_dict_cp_and_mate():
    assert eval_to_dict(Eval(cp=140)) == {"cp": 140, "mate": None, "text": "+1.40"}
    assert eval_to_dict(Eval(mate=3)) == {"cp": None, "mate": 3, "text": "#3"}


def test_line_to_dict_includes_uci_and_san():
    board = chess.Board()
    e4 = chess.Move.from_uci("e2e4")
    e5 = chess.Move.from_uci("e7e5")
    line = Line(multipv=1, eval=Eval(cp=20), depth=18, pv=[e4, e5])
    d = line_to_dict(line, board)
    assert d["multipv"] == 1
    assert d["scoreText"] == "+0.20"
    assert d["pv"] == ["e2e4", "e7e5"]
    assert d["san"] == "1. e4 e5"


def test_line_to_dict_empty_pv():
    board = chess.Board()
    d = line_to_dict(Line(multipv=1, eval=Eval(cp=0), depth=1, pv=[]), board)
    assert d["pv"] == []
    assert d["san"] == ""


def test_analysis_to_dict_shape():
    board = chess.Board()
    e4 = chess.Move.from_uci("e2e4")
    analysis = AnalysisInfo(board.fen(), 18, [Line(1, Eval(cp=30), 18, [e4])])
    d = analysis_to_dict(analysis, board)
    assert d["depth"] == 18
    assert d["eval"] == {"cp": 30, "mate": None, "text": "+0.30"}
    assert d["lines"][0]["pv"] == ["e2e4"]


def test_analysis_to_dict_no_lines_has_null_eval():
    d = analysis_to_dict(AnalysisInfo("x", 0, []), chess.Board())
    assert d["eval"] is None
    assert d["lines"] == []


def test_classification_to_dict():
    c = Classification(MoveClass.BRILLIANT, 0, True)
    assert classification_to_dict(c) == {"label": "brilliant", "cpl": 0, "isBest": True}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/server/test_serialize.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.server.serialize'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/server/serialize.py
from __future__ import annotations

import chess

from ..analysis.classify import Classification
from ..engine.types import AnalysisInfo, Eval, Line


def eval_to_dict(ev: Eval) -> dict:
    return {"cp": ev.cp, "mate": ev.mate, "text": ev.format_white()}


def line_to_dict(line: Line, board: chess.Board) -> dict:
    return {
        "multipv": line.multipv,
        "scoreText": line.eval.format_white(),
        "cp": line.eval.cp,
        "mate": line.eval.mate,
        "pv": [m.uci() for m in line.pv],
        "san": board.variation_san(line.pv) if line.pv else "",
    }


def analysis_to_dict(analysis: AnalysisInfo, board: chess.Board) -> dict:
    best = analysis.best
    return {
        "depth": analysis.depth,
        "eval": eval_to_dict(best.eval) if best is not None else None,
        "lines": [line_to_dict(line, board) for line in analysis.lines],
    }


def classification_to_dict(c: Classification) -> dict:
    return {"label": c.label.value, "cpl": c.cpl, "isBest": c.is_best}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/server/test_serialize.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/server/serialize.py tests/server/test_serialize.py
git commit -m "feat(server): add JSON serialization DTOs"
```

---

### Task 4: AnalysisSession (threaded, throttled, cancellable)

**Files:**
- Create: `chessmenthol/server/session.py`
- Create: `tests/server/test_session.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/server/test_session.py
import threading
import time

import chess

from chessmenthol.engine.types import AnalysisInfo, Eval, Line
from chessmenthol.server.session import AnalysisSession


def _info(depth):
    e4 = chess.Move.from_uci("e2e4")
    return AnalysisInfo(chess.STARTING_FEN, depth, [Line(1, Eval(cp=depth), depth, [e4])])


class FakeStream:
    def __init__(self, infos, block: threading.Event | None = None):
        self._infos = infos
        self._block = block
        self.stopped = False

    def __iter__(self):
        for info in self._infos:
            if self.stopped:
                return
            if self._block is not None:
                self._block.wait(timeout=2.0)
            yield info

    def stop(self):
        self.stopped = True


class FakeEngine:
    def __init__(self, infos, block=None):
        self._infos = infos
        self._block = block
        self.last_stream = None

    def stream_analysis(self, board, *, multipv=None, depth=None, time=None):
        self.last_stream = FakeStream(list(self._infos), self._block)
        return self.last_stream


def _wait_for(predicate, timeout=2.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def test_session_emits_all_updates_with_zero_throttle():
    got = []
    engine = FakeEngine([_info(1), _info(2), _info(3)])
    session = AnalysisSession(engine, lambda info, board: got.append(info), throttle=0.0)
    session.start(chess.Board(), depth=5, multipv=1)
    session.join(timeout=2.0)
    assert [g.depth for g in got] == [1, 2, 3]


def test_session_stop_cancels_stream():
    block = threading.Event()
    engine = FakeEngine([_info(1), _info(2), _info(3)], block=block)
    got = []
    session = AnalysisSession(engine, lambda info, board: got.append(info), throttle=0.0)
    session.start(chess.Board())
    assert _wait_for(lambda: engine.last_stream is not None)
    session.stop()  # request cancel, then unblock so the thread can observe it
    block.set()
    assert engine.last_stream.stopped is True


def test_session_start_replaces_previous_run():
    engine = FakeEngine([_info(1), _info(2)])
    got = []
    session = AnalysisSession(engine, lambda info, board: got.append(info), throttle=0.0)
    session.start(chess.Board())
    session.join(timeout=2.0)
    session.start(chess.Board())
    session.join(timeout=2.0)
    assert len(got) == 4  # two full runs
    session.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/server/test_session.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.server.session'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/server/session.py
from __future__ import annotations

import threading
import time
from typing import Callable, Optional

import chess

from ..engine.types import AnalysisInfo

UpdateCallback = Callable[[AnalysisInfo, chess.Board], None]


class AnalysisSession:
    """Runs streaming analysis on one background thread, throttled and cancellable.

    `engine` only needs a `stream_analysis(board, *, multipv, depth, time)` method
    returning an iterable of AnalysisInfo with a `.stop()` (the real EngineManager,
    or a fake in tests).
    """

    def __init__(self, engine, on_update: UpdateCallback, *,
                 throttle: float = 0.1, monotonic=time.monotonic):
        self._engine = engine
        self._on_update = on_update
        self._throttle = throttle
        self._monotonic = monotonic
        self._lock = threading.Lock()
        self._stream = None
        self._thread: Optional[threading.Thread] = None

    def start(self, board: chess.Board, *, depth=None, multipv=None, time_limit=None) -> None:
        self.stop()
        board_copy = board.copy()
        stream = self._engine.stream_analysis(
            board_copy, multipv=multipv, depth=depth, time=time_limit)
        thread = threading.Thread(target=self._run, args=(stream, board_copy), daemon=True)
        with self._lock:
            self._stream = stream
            self._thread = thread
        thread.start()

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
        except Exception:
            pass

    def join(self, timeout: Optional[float] = None) -> None:
        with self._lock:
            thread = self._thread
        if thread is not None:
            thread.join(timeout=timeout)

    def stop(self) -> None:
        with self._lock:
            stream, thread = self._stream, self._thread
            self._stream, self._thread = None, None
        if stream is not None:
            stream.stop()
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)

    def close(self) -> None:
        self.stop()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/server/test_session.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/pytest -q`
Expected: no failures.

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/server/session.py tests/server/test_session.py
git commit -m "feat(server): add threaded throttled AnalysisSession"
```

---

### Task 5: Orchestrator (command state machine + classification)

**Files:**
- Create: `chessmenthol/server/orchestrator.py`
- Create: `tests/server/test_orchestrator.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/server/test_orchestrator.py
import chess

from chessmenthol.engine.types import AnalysisInfo, Eval, Line
from chessmenthol.server.orchestrator import Orchestrator


def _analysis(fen, cp, moves, depth=12):
    return AnalysisInfo(fen, depth, [Line(1, Eval(cp=cp), depth, moves)])


class FakeSession:
    """Synchronous stand-in: start() immediately emits queued analyses."""

    def __init__(self, engine, on_update):
        self._on_update = on_update
        self.queue = []          # list of AnalysisInfo to emit on next start()
        self.started = 0
        self.stopped = 0

    def start(self, board, *, depth=None, multipv=None, time_limit=None):
        self.started += 1
        for info in self.queue:
            self._on_update(info, board.copy())
        self.queue = []

    def stop(self):
        self.stopped += 1

    def close(self):
        self.stopped += 1


def make_orchestrator():
    frames = []
    session_holder = {}

    def factory(engine, on_update):
        s = FakeSession(engine, on_update)
        session_holder["s"] = s
        return s

    orch = Orchestrator(send=frames.append, engine=object(), session_factory=factory)
    return orch, frames, session_holder


def test_set_fen_updates_board_and_emits_state():
    orch, frames, holder = make_orchestrator()
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(fen, -10, [chess.Move.from_uci("e7e5")])]
    orch.handle({"type": "set_fen", "fen": fen})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["fen"] == fen
    assert state["sideToMove"] == "black"
    assert state["eval"]["cp"] == -10


def test_invalid_fen_emits_error_no_crash():
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_fen", "fen": "not a fen"})
    assert frames[-1]["type"] == "error"


def test_illegal_move_emits_error():
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "make_move", "uci": "e2e5"})  # illegal from start
    assert frames[-1]["type"] == "error"


def test_make_move_advances_board():
    orch, frames, holder = make_orchestrator()
    after = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(after, 25, [chess.Move.from_uci("e7e5")])]
    orch.handle({"type": "make_move", "uci": "e2e4"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3")


def test_make_move_classifies_using_prior_analysis():
    orch, frames, holder = make_orchestrator()
    # First, an analysis of the start position so the orchestrator has a "before".
    holder["s"].queue = [_analysis(chess.STARTING_FEN, 30, [chess.Move.from_uci("e2e4")])]
    orch.handle({"type": "set_fen", "fen": chess.STARTING_FEN})
    # Now play e2e4; the after-position analysis (depth >= classify min) lets it classify.
    after = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(after, 30, [chess.Move.from_uci("e7e5")], depth=12)]
    orch.handle({"type": "make_move", "uci": "e2e4"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["lastMove"]["uci"] == "e2e4"
    assert state["lastMove"]["classification"]["label"] in {
        "best", "great", "excellent", "good", "brilliant", "book", "inaccuracy",
        "mistake", "blunder", "miss",
    }


def test_set_turn_white_black():
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_turn", "white": False})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["sideToMove"] == "black"


def test_set_engine_restarts_session():
    orch, frames, holder = make_orchestrator()
    before = holder["s"].started
    orch.handle({"type": "set_engine", "id": "stockfish_lite"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["engineId"] == "stockfish_lite"
    assert holder["s"].started > before
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.server.orchestrator'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/server/orchestrator.py
from __future__ import annotations

from typing import Callable, Optional, Tuple

import chess

from ..analysis.classify import classify_move
from ..engine.manager import EngineManager
from ..engine.types import AnalysisInfo
from . import serialize
from .session import AnalysisSession

SendCallback = Callable[[dict], None]
CLASSIFY_MIN_DEPTH = 8


class Orchestrator:
    """Owns the working board + settings + analysis session; turns commands into
    state frames pushed via `send`."""

    def __init__(self, send: SendCallback, *, engine=None, session_factory=None):
        self._send = send
        self._engine = engine if engine is not None else EngineManager()
        self._board = chess.Board()
        self._engine_id = "stockfish"
        self._depth: Optional[int] = 18
        self._multipv = 3
        self._engine_started = False
        self._last_analysis: Optional[AnalysisInfo] = None
        self._pending: Optional[Tuple[chess.Board, chess.Move, Optional[AnalysisInfo]]] = None
        self._last_move: Optional[dict] = None
        factory = session_factory or (lambda eng, cb: AnalysisSession(eng, cb))
        self._session = factory(self._engine, self._on_update)

    # ---- command dispatch ----
    def handle(self, cmd: dict) -> None:
        ctype = cmd.get("type")
        try:
            if ctype == "set_fen":
                self.set_fen(cmd["fen"])
            elif ctype == "set_turn":
                self.set_turn(bool(cmd["white"]))
            elif ctype == "make_move":
                self.make_move(cmd["uci"])
            elif ctype == "undo":
                self.undo()
            elif ctype == "set_engine":
                self.set_engine(cmd["id"])
            elif ctype == "set_options":
                self.set_options(cmd)
            elif ctype == "stop":
                self._session.stop()
            else:
                self._error(f"unknown command: {ctype!r}")
        except (KeyError, ValueError) as exc:
            self._error(str(exc))

    # ---- commands ----
    def set_fen(self, fen: str) -> None:
        try:
            board = chess.Board(fen)
        except ValueError as exc:
            self._error(f"invalid FEN: {exc}")
            return
        if not board.is_valid():
            self._error("invalid position")
            return
        self._board = board
        self._reset_move_state()
        self._restart()

    def set_turn(self, white: bool) -> None:
        board = self._board.copy()
        board.turn = chess.WHITE if white else chess.BLACK
        if not board.is_valid():
            self._error("turn change produces an invalid position")
            return
        self._board = board
        self._reset_move_state()
        self._restart()

    def make_move(self, uci: str) -> None:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            self._error(f"invalid move: {uci!r}")
            return
        if move not in self._board.legal_moves:
            self._error(f"illegal move: {uci}")
            return
        before = self._last_analysis
        board_before = self._board.copy()
        self._board.push(move)
        self._last_analysis = None
        self._last_move = None
        self._pending = (board_before, move, before)
        self._restart()

    def undo(self) -> None:
        if self._board.move_stack:
            self._board.pop()
        self._reset_move_state()
        self._restart()

    def set_engine(self, engine_id: str) -> None:
        self._engine_id = engine_id
        self._engine_started = False
        self._restart()

    def set_options(self, cmd: dict) -> None:
        if "depth" in cmd and cmd["depth"] is not None:
            self._depth = int(cmd["depth"])
        if "multipv" in cmd and cmd["multipv"] is not None:
            self._multipv = int(cmd["multipv"])
        threads = cmd.get("threads")
        hash_mb = cmd.get("hash")
        if (threads is not None or hash_mb is not None) and self._engine_started:
            self._engine.configure(threads=threads, hash_mb=hash_mb)
        self._restart()

    def close(self) -> None:
        self._session.close()
        if hasattr(self._engine, "close"):
            self._engine.close()

    # ---- internals ----
    def _reset_move_state(self) -> None:
        self._last_analysis = None
        self._pending = None
        self._last_move = None

    def _restart(self) -> None:
        if not self._engine_started and hasattr(self._engine, "select"):
            self._engine.select(self._engine_id)
            self._engine_started = True
        self._session.start(self._board, depth=self._depth, multipv=self._multipv)
        self._send(self._state_frame(self._last_analysis, self._board))

    def _on_update(self, analysis: AnalysisInfo, board: chess.Board) -> None:
        self._last_analysis = analysis
        if (self._pending is not None and analysis.best is not None
                and analysis.depth >= CLASSIFY_MIN_DEPTH):
            board_before, move, before_a = self._pending
            if before_a is not None and before_a.best is not None:
                c = classify_move(board_before, move, before_a, analysis)
                self._last_move = {
                    "uci": move.uci(),
                    "classification": serialize.classification_to_dict(c),
                }
            self._pending = None
        self._send(self._state_frame(analysis, board))

    def _state_frame(self, analysis: Optional[AnalysisInfo], board: chess.Board) -> dict:
        adict = serialize.analysis_to_dict(analysis, board) if analysis is not None else {
            "depth": 0, "eval": None, "lines": []
        }
        return {
            "type": "state",
            "fen": self._board.fen(),
            "sideToMove": "white" if self._board.turn == chess.WHITE else "black",
            "engineId": self._engine_id,
            "analyzing": True,
            "eval": adict["eval"],
            "depth": adict["depth"],
            "lines": adict["lines"],
            "lastMove": self._last_move,
        }

    def _error(self, message: str) -> None:
        self._send({"type": "error", "message": message})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py -q`
Expected: PASS (7 passed)

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/pytest -q`
Expected: no failures.

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/server/orchestrator.py tests/server/test_orchestrator.py
git commit -m "feat(server): add Orchestrator command state machine with move classification"
```

---

### Task 6: FastAPI app + WebSocket endpoint

**Files:**
- Create: `chessmenthol/server/app.py`
- Create: `tests/server/test_app.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/server/test_app.py
from fastapi.testclient import TestClient

from chessmenthol.server.app import create_app


class FakeOrchestrator:
    """Records commands; can push frames back through `send`."""

    instances = []

    def __init__(self, send):
        self._send = send
        self.commands = []
        self.closed = False
        FakeOrchestrator.instances.append(self)

    def handle(self, cmd):
        self.commands.append(cmd)
        if cmd.get("type") == "ping":
            self._send({"type": "state", "fen": "ok"})

    def close(self):
        self.closed = True


def test_ws_round_trip_command_to_state():
    FakeOrchestrator.instances.clear()
    app = create_app(orchestrator_factory=FakeOrchestrator)
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "ping"})
        frame = ws.receive_json()
    assert frame == {"type": "state", "fen": "ok"}
    assert FakeOrchestrator.instances[-1].commands == [{"type": "ping"}]


def test_ws_closes_orchestrator_on_disconnect():
    FakeOrchestrator.instances.clear()
    app = create_app(orchestrator_factory=FakeOrchestrator)
    client = TestClient(app)
    with client.websocket_connect("/ws"):
        pass
    assert FakeOrchestrator.instances[-1].closed is True


def test_health_endpoint():
    app = create_app(orchestrator_factory=FakeOrchestrator)
    client = TestClient(app)
    assert client.get("/healthz").json() == {"status": "ok"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/server/test_app.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.server.app'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/server/app.py
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Callable, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .orchestrator import Orchestrator

OrchestratorFactory = Callable[[Callable[[dict], None]], object]

_STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app(*, orchestrator_factory: Optional[OrchestratorFactory] = None) -> FastAPI:
    factory = orchestrator_factory or (lambda send: Orchestrator(send=send))
    app = FastAPI(title="ChessMenthol")

    @app.get("/healthz")
    def healthz() -> JSONResponse:
        return JSONResponse({"status": "ok"})

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def send(frame: dict) -> None:
            # Called from any thread (the analysis worker). Hand off to the loop.
            asyncio.run_coroutine_threadsafe(queue.put(frame), loop)

        orch = factory(send)

        async def pump() -> None:
            while True:
                frame = await queue.get()
                await websocket.send_json(frame)

        pump_task = asyncio.create_task(pump())
        try:
            while True:
                cmd = await websocket.receive_json()
                orch.handle(cmd)
        except WebSocketDisconnect:
            pass
        finally:
            pump_task.cancel()
            orch.close()

    # Serve the built frontend if present (Milestone 2b produces it).
    if _STATIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")

    return app
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/server/test_app.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/pytest -q`
Expected: no failures.

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/server/app.py tests/server/test_app.py
git commit -m "feat(server): add FastAPI app with /ws WebSocket bridge"
```

---

### Task 7: Launcher + entry points

**Files:**
- Create: `chessmenthol/server/launcher.py`
- Create: `tests/server/test_launcher.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/server/test_launcher.py
from chessmenthol.server import launcher


def test_run_server_invokes_uvicorn(monkeypatch):
    calls = {}

    def fake_run(app, host, port, **kwargs):
        calls["host"] = host
        calls["port"] = port
        calls["app"] = app

    monkeypatch.setattr(launcher.uvicorn, "run", fake_run)
    launcher.run_server(host="127.0.0.1", port=53999)
    assert calls["host"] == "127.0.0.1"
    assert calls["port"] == 53999
    assert calls["app"] is not None


def test_run_app_starts_server_thread_then_opens_window(monkeypatch):
    events = []

    def fake_serve(host, port):
        events.append(("serve", host, port))

    def fake_open_window(url):
        events.append(("window", url))

    monkeypatch.setattr(launcher, "_serve_in_thread", fake_serve)
    monkeypatch.setattr(launcher, "_open_window", fake_open_window)
    launcher.run_app(host="127.0.0.1", port=54123)
    assert ("serve", "127.0.0.1", 54123) in events
    assert ("window", "http://127.0.0.1:54123") in events
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/server/test_launcher.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'chessmenthol.server.launcher'`

- [ ] **Step 3: Write minimal implementation**

```python
# chessmenthol/server/launcher.py
from __future__ import annotations

import threading
import time

import uvicorn

from .app import create_app

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def run_server(*, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    """Run the FastAPI app under uvicorn (blocking). Entry point: chessmenthol-server."""
    uvicorn.run(create_app(), host=host, port=port, log_level="info")


def _serve_in_thread(host: str, port: int) -> None:
    config = uvicorn.Config(create_app(), host=host, port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    # give uvicorn a moment to bind before the window loads the URL
    time.sleep(1.0)


def _open_window(url: str) -> None:
    import webview  # provided by the optional `desktop` extra (pywebview)

    webview.create_window("ChessMenthol", url, width=1100, height=720)
    webview.start()


def run_app(*, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    """Start the server in a background thread and open a native window.

    Entry point: chessmenthol-app. Requires the `desktop` extra (pywebview).
    """
    _serve_in_thread(host, port)
    _open_window(f"http://{host}:{port}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/server/test_launcher.py -q`
Expected: PASS (2 passed) — note the tests monkeypatch out the real server/window, so neither uvicorn nor pywebview actually starts.

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/pytest -q`
Expected: no failures.

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/server/launcher.py tests/server/test_launcher.py
git commit -m "feat(server): add uvicorn/pywebview launcher entry points"
```

---

### Task 8: End-to-end WebSocket integration (real engine)

**Files:**
- Modify: `tests/server/test_app.py` (append)

- [ ] **Step 1: Write the failing test (append)**

```python
# tests/server/test_app.py  (append)
import pytest


@pytest.mark.engine
def test_ws_streams_real_analysis_for_set_fen():
    from chessmenthol.server.app import create_app

    app = create_app()  # real Orchestrator + real Stockfish
    client = TestClient(app)
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "set_options", "depth": 10, "multipv": 2})
        ws.send_json({"type": "set_fen", "fen": fen})
        # collect frames until we see at least one with analyzed lines
        got_lines = None
        for _ in range(60):
            frame = ws.receive_json()
            if frame.get("type") == "state" and frame.get("lines"):
                got_lines = frame
                break
        ws.send_json({"type": "stop"})
    assert got_lines is not None
    assert got_lines["fen"] == fen
    assert got_lines["sideToMove"] == "black"
    assert len(got_lines["lines"]) >= 1
    assert "scoreText" in got_lines["lines"][0]
```

- [ ] **Step 2: Run test to verify it passes (or skips without Stockfish)**

Run: `.venv/bin/pytest tests/server/test_app.py -q`
Expected: PASS — with Stockfish bundled, the real engine streams at least one state frame with lines. (If a frame parse blocks, the loop bound of 60 frames keeps the test from hanging.)

- [ ] **Step 3: Run the full suite**

Run: `.venv/bin/pytest -q`
Expected: no failures.

- [ ] **Step 4: Manual smoke (optional, requires the desktop extra)**

```bash
.venv/bin/pip install -e ".[desktop]"   # only if system webview libs are available
.venv/bin/chessmenthol-server            # then connect a WS client to ws://127.0.0.1:8765/ws
```
If the `desktop` extra can't install (missing system webview libs), that's fine — it's exercised in Milestone 5 packaging; `chessmenthol-server` still runs without it.

- [ ] **Step 5: Commit**

```bash
git add tests/server/test_app.py
git commit -m "test(server): end-to-end WebSocket streaming with real engine"
```

---

## Self-Review (completed by author)

**Spec coverage (M2a backend scope):**
- §6.1 streaming primitive → Task 2 (`stream_analysis` + `AnalysisStream`). ✓
- §6.2 serialization DTOs → Task 3. ✓
- §6.3 Orchestrator + AnalysisSession → Tasks 4 (session) + 5 (orchestrator), incl. last-move classification. ✓
- §6.4 FastAPI + /ws + static serving + thread→async bridge → Task 6. ✓
- §6.5 launcher + entry points → Tasks 1 (scripts) + 7 (launcher). ✓
- §7 WebSocket protocol (commands + state/error frames) → Tasks 5–6 + 8. ✓
- §9 error handling (invalid FEN/move, disconnect close) → Tasks 5–6. ✓
- §11 testing (hermetic vs engine-marked split, fakes, TestClient) → every task. ✓
- Frontend (§6.6) is intentionally out of M2a → Milestone 2b plan.

**Placeholder scan:** No TBD/TODO; every code step is complete. The static mount is conditional on the M2b build dir existing (documented), not a placeholder.

**Type consistency:** `AnalysisStream`/`stream_analysis` signature (Task 2) matches `AnalysisSession`'s `engine.stream_analysis(...)` call (Task 4) and the `FakeEngine` in tests. `AnalysisSession(engine, on_update, throttle=)` (Task 4) matches the `session_factory(engine, on_update)` call in `Orchestrator` (Task 5). `serialize.analysis_to_dict/classification_to_dict` (Task 3) are used unchanged in `Orchestrator` (Task 5). `create_app(orchestrator_factory=...)` and `factory(send)` (Task 6) match `Orchestrator(send=...)` (Task 5) and the `FakeOrchestrator(send)` test. Launcher `_serve_in_thread`/`_open_window` (Task 7) match their tests. State-frame keys (`fen,sideToMove,eval,depth,lines,engineId,analyzing,lastMove`) are consistent between Task 5 and the assertions in Tasks 5/8.

## Notes for Milestone 2b (frontend)
- The frontend builds to `chessmenthol/server/static/` (or copies there) so `app.py`'s conditional mount serves it; M2b sets up that build output path.
- M2b consumes exactly the §7 protocol: send the command frames, render the `state` frames (eval bar, multi-PV lines, last-move badge), show `error` frames.
- The thread→async bridge and throttling are already handled server-side; the frontend just renders whatever `state` frames arrive.
