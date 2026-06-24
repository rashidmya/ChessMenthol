import os
import shutil
from pathlib import Path

import pytest

_BUNDLED = Path(__file__).resolve().parent.parent / "chessmenthol" / "engines" / "stockfish"


def _stockfish_available() -> bool:
    env = os.environ.get("CHESSMENTHOL_STOCKFISH")
    if env and Path(env).is_file():
        return True
    if (_BUNDLED / "stockfish").exists() or (_BUNDLED / "stockfish.exe").exists():
        return True
    return shutil.which("stockfish") is not None


def pytest_collection_modifyitems(config, items):
    if _stockfish_available():
        return
    skip = pytest.mark.skip(reason="Stockfish not installed")
    for item in items:
        if "engine" in item.keywords:
            item.add_marker(skip)
