from pathlib import Path

import pytest

from chessmenthol.engine.spec import EngineSpec, default_registry, _resolve_binary


def test_resolve_binary_prefers_env(monkeypatch, tmp_path):
    fake = tmp_path / "sf"
    fake.write_text("")
    monkeypatch.setenv("CHESSMENTHOL_STOCKFISH", str(fake))
    assert _resolve_binary() == fake


def test_resolve_binary_env_missing_path_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("CHESSMENTHOL_STOCKFISH", str(tmp_path / "nope"))
    with pytest.raises(FileNotFoundError):
        _resolve_binary()


def test_resolve_binary_falls_back_to_path(monkeypatch):
    monkeypatch.delenv("CHESSMENTHOL_STOCKFISH", raising=False)
    monkeypatch.setattr("chessmenthol.engine.spec._bundled_binary", lambda: None)
    monkeypatch.setattr("chessmenthol.engine.spec.shutil.which", lambda name: "/usr/bin/stockfish")
    assert _resolve_binary() == Path("/usr/bin/stockfish")


def test_resolve_binary_raises_when_missing(monkeypatch):
    monkeypatch.delenv("CHESSMENTHOL_STOCKFISH", raising=False)
    monkeypatch.setattr("chessmenthol.engine.spec._bundled_binary", lambda: None)
    monkeypatch.setattr("chessmenthol.engine.spec.shutil.which", lambda name: None)
    with pytest.raises(FileNotFoundError):
        _resolve_binary()


def test_default_registry_has_both_engines(monkeypatch, tmp_path):
    fake = tmp_path / "sf"
    fake.write_text("")
    monkeypatch.setenv("CHESSMENTHOL_STOCKFISH", str(fake))
    reg = default_registry()
    assert set(reg) == {"stockfish", "stockfish_lite"}
    assert isinstance(reg["stockfish"], EngineSpec)
    assert reg["stockfish_lite"].default_options["Threads"] == 1
    # registry invariants EngineManager.select() will rely on
    assert reg["stockfish"].binary == reg["stockfish_lite"].binary
    for key, spec in reg.items():
        assert spec.id == key
