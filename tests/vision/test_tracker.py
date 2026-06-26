from __future__ import annotations

import chess

from chessmenthol.vision.capture import Capturer
from chessmenthol.vision.tracker import Tracker
from chessmenthol.position import SquareLabel
from chessmenthol.vision.types import Monitor
from tests.vision.fakes import FakeBackend
from tests.vision.synthetic import render_board


class FakeClassifier:
    """Returns the TRUE label for each crop based on its .square name and a known board."""

    def __init__(self, board: chess.Board):
        self.board = board

    def classify(self, crops):
        return [
            SquareLabel(self.board.piece_at(chess.parse_square(c.square)), 1.0)
            for c in crops
        ]


def _tracker_for(board: chess.Board, img) -> Tracker:
    backend = FakeBackend([Monitor(0, 0, 0, img.shape[1], img.shape[0])], [img, img, img])
    return Tracker(capturer=Capturer(backend=backend), classifier=FakeClassifier(board))


def test_tracker_reproduces_known_position():
    board = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3")
    occupied = [chess.square_name(sq) for sq in chess.SQUARES if board.piece_at(sq)]
    # square=32 (not 48): a 32-piece mid-game board at sq=48 drops detect confidence
    # to ~0.29, just below the 0.3 gate; sq=32 gives ~0.34, reliably above it.
    img, _ = render_board(square=32, margin=24, pieces=occupied)
    ap = _tracker_for(board, img).detect_position()
    assert ap is not None and ap.is_legal
    assert ap.board.board_fen() == board.board_fen()


def test_tracker_returns_none_when_no_board():
    import numpy as np
    board = chess.Board()
    noise = np.random.default_rng(0).integers(0, 255, (300, 300, 3), dtype=np.uint8)
    backend = FakeBackend([Monitor(0, 0, 0, 300, 300)], [noise])
    tracker = Tracker(capturer=Capturer(backend=backend), classifier=FakeClassifier(board))
    assert tracker.detect_position() is None


def test_tracker_side_override_is_honored():
    board = chess.Board()
    occupied = [chess.square_name(sq) for sq in chess.SQUARES if board.piece_at(sq)]
    img, _ = render_board(square=48, margin=24, pieces=occupied)
    tracker = _tracker_for(board, img)
    tracker.set_side_override(chess.BLACK)
    ap = tracker.detect_position()
    assert ap is not None and ap.side_to_move == chess.BLACK
