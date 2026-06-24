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
    depths = [s.depth for s in snapshots]
    assert depths[-1] >= depths[0]


@pytest.mark.engine
def test_stream_analysis_context_manager_stops_on_exit():
    with EngineManager() as em:
        em.select("stockfish")
        with em.stream_analysis(chess.Board(), depth=10, multipv=1) as stream:
            first = next(iter(stream))
    assert first.best is not None
