from __future__ import annotations

import chess

from chessmenthol.position import AssembledPosition, SquareLabel, assemble
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


def test_assemble_roundtrips_start_position():
    board = chess.Board()
    grid = board_to_grid(board, "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert ap.is_legal is True
    assert ap.status == "valid"
    assert ap.board is not None
    assert ap.board.board_fen() == board.board_fen()


def test_assemble_roundtrips_midgame():
    board = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3")
    grid = board_to_grid(board, "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert ap.board.board_fen() == board.board_fen()


def test_assemble_orientation_maps_geometric_origin():
    # white rook at geometric top-left (row0,col0); kings placed so BOTH
    # orientations yield a legal position (no checks, kings not adjacent).
    grid = [[SquareLabel(None, 1.0) for _ in range(8)] for _ in range(8)]
    grid[0][0] = SquareLabel(chess.Piece(chess.ROOK, chess.WHITE), 1.0)
    grid[7][7] = SquareLabel(chess.Piece(chess.KING, chess.WHITE), 1.0)
    grid[3][3] = SquareLabel(chess.Piece(chess.KING, chess.BLACK), 1.0)
    wb = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    bb = assemble(grid, orientation="black_bottom", side_to_move=chess.WHITE)
    # top-left geometric square is a8 under white_bottom, h1 under black_bottom
    assert wb.board.piece_at(chess.A8) == chess.Piece(chess.ROOK, chess.WHITE)
    assert bb.board.piece_at(chess.H1) == chess.Piece(chess.ROOK, chess.WHITE)


def test_assemble_illegal_two_white_kings():
    grid = [[SquareLabel(None, 1.0) for _ in range(8)] for _ in range(8)]
    grid[7][0] = SquareLabel(chess.Piece(chess.KING, chess.WHITE), 1.0)
    grid[7][7] = SquareLabel(chess.Piece(chess.KING, chess.WHITE), 1.0)
    grid[0][0] = SquareLabel(chess.Piece(chess.KING, chess.BLACK), 1.0)
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert ap.is_legal is False
    assert ap.board is None
    assert "king" in ap.status
    assert ap.fen  # best-guess FEN still produced
