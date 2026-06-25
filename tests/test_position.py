from __future__ import annotations

import chess

from chessmenthol.position import AssembledPosition, SquareLabel
from tests.position_grids import board_to_grid


def test_square_label_holds_piece_and_confidence():
    label = SquareLabel(piece=chess.Piece(chess.QUEEN, chess.WHITE), confidence=0.9)
    assert label.piece.symbol() == "Q"
    assert label.confidence == 0.9
    empty = SquareLabel(piece=None, confidence=0.1)
    assert empty.piece is None


def test_assembled_position_fields():
    ap = AssembledPosition(
        fen="8/8/8/8/8/8/8/8 w - - 0 1",
        board=None,
        is_legal=False,
        status="empty",
        low_confidence=[],
        move=None,
        orientation="white_bottom",
        side_to_move=chess.WHITE,
    )
    assert ap.is_legal is False
    assert ap.orientation == "white_bottom"


def test_board_to_grid_roundtrips_piece_positions():
    board = chess.Board()  # start position
    grid = board_to_grid(board, "white_bottom")
    assert len(grid) == 8 and len(grid[0]) == 8
    # geometric top-left (row0,col0) is a8 under white_bottom -> black rook
    assert grid[0][0].piece == chess.Piece(chess.ROOK, chess.BLACK)
    # geometric bottom-right (row7,col7) is h1 -> white rook
    assert grid[7][7].piece == chess.Piece(chess.ROOK, chess.WHITE)
    # an empty middle square
    assert grid[4][4].piece is None
