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


def _infer_castling_rights(board: chess.Board) -> chess.Bitboard:
    rights = chess.BB_EMPTY
    wk = chess.Piece(chess.KING, chess.WHITE)
    bk = chess.Piece(chess.KING, chess.BLACK)
    wr = chess.Piece(chess.ROOK, chess.WHITE)
    br = chess.Piece(chess.ROOK, chess.BLACK)
    if board.piece_at(chess.E1) == wk:
        if board.piece_at(chess.H1) == wr:
            rights |= chess.BB_H1
        if board.piece_at(chess.A1) == wr:
            rights |= chess.BB_A1
    if board.piece_at(chess.E8) == bk:
        if board.piece_at(chess.H8) == br:
            rights |= chess.BB_H8
        if board.piece_at(chess.A8) == br:
            rights |= chess.BB_A8
    return rights


def infer_move(prev_board: chess.Board, new_board: chess.Board) -> Optional[chess.Move]:
    """Return the single legal move from prev_board whose resulting piece
    placement matches new_board, or None if zero or multiple match.

    Compares board_fen() (placement only) — ignores side-to-move/castling/ep,
    which a screenshot cannot observe. Correct-by-construction for castling,
    en-passant, and promotion (each yields a distinct placement).
    """
    target = new_board.board_fen()
    found: Optional[chess.Move] = None
    for move in prev_board.legal_moves:
        prev_board.push(move)
        matches = prev_board.board_fen() == target
        prev_board.pop()
        if matches:
            if found is not None:
                return None  # ambiguous (should not happen for distinct legal moves)
            found = move
    return found


def _maybe_set_ep_square(
    board: chess.Board, prev_board: chess.Board, move: chess.Move
) -> None:
    if prev_board.piece_type_at(move.from_square) != chess.PAWN:
        return
    from_rank = chess.square_rank(move.from_square)
    to_rank = chess.square_rank(move.to_square)
    if abs(from_rank - to_rank) == 2:
        file = chess.square_file(move.from_square)
        board.ep_square = chess.square(file, (from_rank + to_rank) // 2)


def guess_orientation(grid: list[list[SquareLabel]]) -> Optional[str]:
    """Best-effort orientation from piece layout. Returns None when ambiguous.

    Compares the two outermost geometric rows on each edge: white pieces
    concentrated at the bottom (and black at the top) implies white_bottom.
    """

    def balance(rows: list[int]) -> tuple[int, int]:
        white = black = 0
        for r in rows:
            for label in grid[r]:
                if label.piece is not None:
                    if label.piece.color == chess.WHITE:
                        white += 1
                    else:
                        black += 1
        return white, black

    bottom_white, bottom_black = balance([6, 7])
    top_white, top_black = balance([0, 1])
    if bottom_white + bottom_black + top_white + top_black < 6:
        return None
    if bottom_white > bottom_black and top_black > top_white:
        return "white_bottom"
    if top_white > top_black and bottom_black > bottom_white:
        return "black_bottom"
    return None


def guess_side_to_move(
    board: chess.Board,
    *,
    prev_board: Optional[chess.Board] = None,
    move: Optional[chess.Move] = None,
    highlight_squares: Optional[list[str]] = None,
) -> chess.Color:
    """Best-effort side to move. The caller (M4c) owns user override."""
    if prev_board is not None and move is not None:
        return not prev_board.turn
    if highlight_squares:
        # For a genuine last move the origin square is empty post-move, so exactly
        # one highlighted square is occupied — the destination — making this
        # order-independent. The piece there is the mover; the other side is to move.
        for name in highlight_squares:
            piece = board.piece_at(chess.parse_square(name))
            if piece is not None:
                return not piece.color
    return chess.WHITE


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
    board.castling_rights = _infer_castling_rights(board)

    status = board.status()
    is_legal = status == chess.STATUS_VALID
    move = (
        infer_move(prev_board, board)
        if prev_board is not None and is_legal
        else None
    )
    if move is not None:
        _maybe_set_ep_square(board, prev_board, move)
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
        move=move,
        orientation=orientation,
        side_to_move=side_to_move,
    )
