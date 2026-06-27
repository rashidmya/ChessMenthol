import chess
import chess.engine
import pytest

from chessmenthol.engine.manager import AnalysisStream, EngineManager
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
    assert len(snapshots) >= 2
    assert all(isinstance(s, AnalysisInfo) for s in snapshots)
    assert snapshots[-1].best is not None
    depths = [s.depth for s in snapshots]
    assert depths[-1] >= depths[0]


@pytest.mark.engine
def test_stream_analysis_context_manager_stops_on_exit():
    with EngineManager() as em:
        em.select("stockfish")
        with em.stream_analysis(chess.Board(), depth=10, multipv=1) as stream:
            first = next(iter(stream))
    assert first.best is not None


def test_stream_analysis_infinite_when_no_depth_or_time():
    """stream_analysis() with no depth/time must produce an unbounded Limit (no fallback)."""
    recorded: dict = {}

    class FakeResult:
        def __iter__(self):
            return iter([])

        def stop(self):
            pass

    class FakeEngine:
        def analysis(self, board, limit, *, multipv=None):
            recorded["limit"] = limit
            return FakeResult()

    mgr = EngineManager()
    mgr._engine = FakeEngine()
    mgr.stream_analysis(chess.Board())
    lim = recorded["limit"]
    assert lim.depth is None, f"expected depth=None, got {lim.depth}"
    assert lim.time is None, f"expected time=None, got {lim.time}"


def test_analysis_stream_stopped_reflects_stop():
    """AnalysisStream.stopped is False until stop() is called, then True (idempotent)."""

    class FakeResult:
        def __init__(self):
            self.stop_calls = 0

        def __iter__(self):
            return iter([])

        def stop(self):
            self.stop_calls += 1

    result = FakeResult()
    stream = AnalysisStream(result, chess.STARTING_FEN)
    assert stream.stopped is False
    stream.stop()
    assert stream.stopped is True
    stream.stop()  # idempotent: underlying result.stop() not called twice
    assert result.stop_calls == 1
