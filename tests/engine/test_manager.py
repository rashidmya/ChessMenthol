import chess
import chess.engine
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
    with EngineManager() as em:
        with pytest.raises(RuntimeError):
            em.analyze(chess.Board(), depth=4)


def test_select_unknown_engine_raises(monkeypatch, tmp_path):
    fake = tmp_path / "sf"
    fake.write_text("")
    monkeypatch.setenv("CHESSMENTHOL_STOCKFISH", str(fake))
    em = EngineManager()
    with pytest.raises(KeyError):
        em.select("komodo")


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
        assert em._engine is not first  # restart actually spawned a new process
    assert state["raised"] is True
    assert info.best is not None


def test_configure_updates_multipv_without_engine(monkeypatch, tmp_path):
    fake = tmp_path / "sf"
    fake.write_text("")
    monkeypatch.setenv("CHESSMENTHOL_STOCKFISH", str(fake))
    em = EngineManager()
    em.configure(multipv=5)
    assert em._multipv == 5


def test_close_is_idempotent_without_engine(monkeypatch, tmp_path):
    fake = tmp_path / "sf"
    fake.write_text("")
    monkeypatch.setenv("CHESSMENTHOL_STOCKFISH", str(fake))
    em = EngineManager()
    em.close()
    em.close()  # second call must not raise
