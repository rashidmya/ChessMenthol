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


def _status_text(status: chess.Status) -> str:
    if status == chess.STATUS_VALID:
        return "valid"
    return ", ".join(flag.name.lower().replace("_", " ") for flag in status)


def assemble(
    grid: list[list[SquareLabel]],
    *,
    orientation: str,
    side_to_move: chess.Color,
    prev_board: Optional[chess.Board] = None,
    confidence_threshold: float = 0.5,
) -> AssembledPosition:
    board = chess.Board.empty()
    for row in range(8):
        for col in range(8):
            label = grid[row][col]
            if label.piece is not None:
                square = chess.parse_square(square_name(col, row, orientation))
                board.set_piece_at(square, label.piece)
    board.turn = side_to_move

    status = board.status()
    is_legal = status == chess.STATUS_VALID
    # en_passant="fen" so a set ep square always shows (python-chess's default
    # "legal" mode hides it when no ep capture is currently possible).
    fen = board.fen(en_passant="fen")
    low_conf = [
        square_name(col, row, orientation)
        for row in range(8)
        for col in range(8)
        if grid[row][col].confidence < confidence_threshold
    ]
    return AssembledPosition(
        fen=fen,
        board=board if is_legal else None,
        is_legal=is_legal,
        status=_status_text(status),
        low_confidence=low_conf,
        move=None,
        orientation=orientation,
        side_to_move=side_to_move,
    )
