from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import chess

from chessmenthol.vision.types import square_name


@dataclass(frozen=True)
class SquareLabel:
    """One classified square. `piece=None` means an empty square."""

    piece: Optional[chess.Piece]
    confidence: float


@dataclass(frozen=True)
class AssembledPosition:
    fen: str
    board: Optional[chess.Board]
    is_legal: bool
    status: str
    low_confidence: list[str]
    move: Optional[chess.Move]
    orientation: str
    side_to_move: chess.Color
