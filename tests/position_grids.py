from __future__ import annotations

import chess

from chessmenthol.position import SquareLabel
from chessmenthol.vision.types import square_name


def board_to_grid(
    board: chess.Board, orientation: str = "white_bottom", confidence: float = 1.0
) -> list[list[SquareLabel]]:
    """Inverse of `assemble`'s placement step: render a board into an 8x8
    geometric grid (grid[row][col], row 0 = board top, col 0 = left)."""
    grid: list[list[SquareLabel]] = []
    for row in range(8):
        grid_row: list[SquareLabel] = []
        for col in range(8):
            sq = chess.parse_square(square_name(col, row, orientation))
            grid_row.append(SquareLabel(board.piece_at(sq), confidence))
        grid.append(grid_row)
    return grid
