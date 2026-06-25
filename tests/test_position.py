from __future__ import annotations

import chess

from chessmenthol.position import AssembledPosition, SquareLabel, assemble, infer_move
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


def test_assemble_flags_low_confidence_squares():
    board = chess.Board()
    grid = board_to_grid(board, "white_bottom", confidence=0.9)
    # knock two squares below the default 0.5 threshold: a piece (a8) and an empty (e4)
    grid[0][0] = SquareLabel(grid[0][0].piece, 0.2)   # a8
    grid[4][4] = SquareLabel(None, 0.1)               # e4, low-confidence empty
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert set(ap.low_confidence) == {"a8", "e4"}


def test_assemble_no_low_confidence_when_all_above_threshold():
    grid = board_to_grid(chess.Board(), "white_bottom", confidence=0.95)
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert ap.low_confidence == []


def test_assemble_grants_full_castling_for_start_position():
    grid = board_to_grid(chess.Board(), "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    # FEN castling field is the 3rd token
    assert ap.fen.split()[2] == "KQkq"


def test_assemble_withholds_castling_when_rook_off_home():
    board = chess.Board()
    board.remove_piece_at(chess.A1)  # white queen-side rook missing from home
    grid = board_to_grid(board, "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    castling = ap.fen.split()[2]
    assert "Q" not in castling  # queen-side white right withheld
    assert "K" in castling and "k" in castling and "q" in castling


def test_assemble_no_castling_when_kings_off_home():
    grid = [[SquareLabel(None, 1.0) for _ in range(8)] for _ in range(8)]
    grid[7][4] = SquareLabel(chess.Piece(chess.KING, chess.WHITE), 1.0)   # e1
    grid[7][0] = SquareLabel(chess.Piece(chess.ROOK, chess.WHITE), 1.0)   # a1
    grid[7][7] = SquareLabel(chess.Piece(chess.ROOK, chess.WHITE), 1.0)   # h1
    grid[3][3] = SquareLabel(chess.Piece(chess.KING, chess.BLACK), 1.0)   # d5 (off home)
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    # white may castle (king+rooks home); black cannot (king off home)
    castling = ap.fen.split()[2]
    assert "K" in castling and "Q" in castling
    assert "k" not in castling and "q" not in castling


def _after(board: chess.Board, uci: str) -> chess.Board:
    nxt = board.copy()
    nxt.push(chess.Move.from_uci(uci))
    return nxt


def test_infer_move_quiet():
    prev = chess.Board()
    assert infer_move(prev, _after(prev, "e2e4")) == chess.Move.from_uci("e2e4")


def test_infer_move_capture():
    prev = chess.Board("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1")
    assert infer_move(prev, _after(prev, "e4d5")) == chess.Move.from_uci("e4d5")


def test_infer_move_kingside_castle():
    prev = chess.Board("4k3/8/8/8/8/8/8/4K2R w K - 0 1")
    assert infer_move(prev, _after(prev, "e1g1")) == chess.Move.from_uci("e1g1")


def test_infer_move_queenside_castle():
    prev = chess.Board("4k3/8/8/8/8/8/8/R3K3 w Q - 0 1")
    assert infer_move(prev, _after(prev, "e1c1")) == chess.Move.from_uci("e1c1")


def test_infer_move_promotion_queen_vs_knight():
    prev = chess.Board("4k3/P7/8/8/8/8/8/4K3 w - - 0 1")
    assert infer_move(prev, _after(prev, "a7a8q")) == chess.Move.from_uci("a7a8q")
    assert infer_move(prev, _after(prev, "a7a8n")) == chess.Move.from_uci("a7a8n")


def test_infer_move_en_passant():
    prev = chess.Board("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1")
    assert infer_move(prev, _after(prev, "e5d6")) == chess.Move.from_uci("e5d6")


def test_infer_move_returns_none_for_multi_move_jump():
    prev = chess.Board()
    two = _after(prev, "e2e4")
    two.push(chess.Move.from_uci("e7e5"))
    assert infer_move(prev, two) is None


def test_infer_move_returns_none_for_unreachable_placement():
    prev = chess.Board()
    unreachable = chess.Board("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
    assert infer_move(prev, unreachable) is None
