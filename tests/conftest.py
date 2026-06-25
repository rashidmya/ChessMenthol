import importlib.util
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


def _torch_available() -> bool:
    return importlib.util.find_spec("torch") is not None


def pytest_collection_modifyitems(config, items):
    skip_engine = pytest.mark.skip(reason="Stockfish not installed")
    skip_convert = pytest.mark.skip(reason="[convert] extra (torch/onnx) not installed")
    for item in items:
        if "engine" in item.keywords and not _stockfish_available():
            item.add_marker(skip_engine)
        if "convert" in item.keywords and not _torch_available():
            item.add_marker(skip_convert)
