from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict


@dataclass(frozen=True)
class EngineSpec:
    id: str
    name: str
    binary: Path
    default_options: Dict[str, object] = field(default_factory=dict)


def _resolve_binary() -> Path:
    env = os.environ.get("CHESSMENTHOL_STOCKFISH")
    if env:
        return Path(env)
    bundled_dir = Path(__file__).resolve().parent.parent / "engines" / "stockfish"
    for exe in ("stockfish", "stockfish.exe"):
        candidate = bundled_dir / exe
        if candidate.exists():
            return candidate
    found = shutil.which("stockfish")
    if found:
        return Path(found)
    raise FileNotFoundError(
        "Stockfish binary not found. Run `python scripts/fetch_engines.py` to download it, "
        "set CHESSMENTHOL_STOCKFISH, or install stockfish on PATH."
    )


def default_registry() -> Dict[str, EngineSpec]:
    """Two bundled presets sharing one binary in dev; Lite gets its own net later."""
    binary = _resolve_binary()
    return {
        "stockfish": EngineSpec(
            id="stockfish",
            name="Stockfish",
            binary=binary,
            default_options={"Threads": 2, "Hash": 256},
        ),
        "stockfish_lite": EngineSpec(
            id="stockfish_lite",
            name="Stockfish Lite",
            binary=binary,
            default_options={"Threads": 1, "Hash": 64},
        ),
    }
