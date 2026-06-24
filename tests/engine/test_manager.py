import chess
import pytest

from chessmenthol.engine.manager import EngineManager


@pytest.mark.engine
def test_select_then_analyze_returns_requested_lines():
    with EngineManager() as em:
        em.select("stockfish")
        assert em.active_id == "stockfish"
        info = em.analyze(chess.Board(), depth=12, multipv=3)
    assert len(info.lines) == 3
    assert info.best is not None and info.best.move is not None
    assert info.depth >= 1


@pytest.mark.engine
def test_analyze_without_selecting_raises():
    em = EngineManager()
    with pytest.raises(RuntimeError):
        em.analyze(chess.Board(), depth=4)


def test_select_unknown_engine_raises(monkeypatch, tmp_path):
    fake = tmp_path / "sf"
    fake.write_text("")
    monkeypatch.setenv("CHESSMENTHOL_STOCKFISH", str(fake))
    em = EngineManager()
    with pytest.raises(KeyError):
        em.select("komodo")


import chess.engine


@pytest.mark.engine
def test_switching_engine_changes_active_id():
    with EngineManager() as em:
        em.select("stockfish")
        assert em.active_id == "stockfish"
        em.select("stockfish_lite")
        assert em.active_id == "stockfish_lite"
        info = em.analyze(chess.Board(), depth=8, multipv=1)
    assert info.best is not None


@pytest.mark.engine
def test_analyze_retries_after_engine_error(monkeypatch):
    with EngineManager() as em:
        em.select("stockfish")
        first = em._engine
        state = {"raised": False}
        original = first.analyse

        def flaky(*args, **kwargs):
            if not state["raised"]:
                state["raised"] = True
                raise chess.engine.EngineError("simulated crash")
            return original(*args, **kwargs)

        monkeypatch.setattr(first, "analyse", flaky)
        info = em.analyze(chess.Board(), depth=8, multipv=1)
    assert state["raised"] is True
    assert info.best is not None
