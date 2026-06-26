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


def test_session_analyzes_stackless_position():
    # python-chess transmits a position to the engine by replaying the move stack
    # (`position ... moves ...`). If the board's stack does not cleanly replay from
    # its root (e.g. after a turn flip), the engine searches a different position
    # than python-chess parses against -> illegal-PV spam + a crashed worker.
    # The session must hand the engine a STACKLESS board (just the current FEN).
    captured = {}

    class CapturingEngine:
        def stream_analysis(self, board, *, multipv=None, depth=None, time=None):
            captured["board"] = board
            return FakeStream([])

    board = chess.Board()
    for uci in ("e2e4", "e7e5", "g1f3"):
        board.push(chess.Move.from_uci(uci))

    session = AnalysisSession(CapturingEngine(), lambda info, b: None, throttle=0.0)
    session.start(board, depth=5, multipv=1)
    session.join(timeout=2.0)

    handed = captured["board"]
    assert handed.fen() == board.fen()          # same position + side to move
    assert list(handed.move_stack) == []        # but no replayable history


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
