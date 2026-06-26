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


def test_tracker_orientation_override_is_honored():
    board = chess.Board()
    occupied = [chess.square_name(sq) for sq in chess.SQUARES if board.piece_at(sq)]
    img, _ = render_board(square=32, margin=24, pieces=occupied)
    tracker = _tracker_for(board, img)
    tracker.set_orientation_override("black_bottom")
    ap = tracker.detect_position()
    assert ap is not None
    assert ap.orientation == "black_bottom"


def test_tracker_infers_move_across_frames():
    import chess as _c

    class SeqClassifier:
        def __init__(self, boards):
            self.boards = boards
            self.i = 0
        def classify(self, crops):
            b = self.boards[min(self.i, len(self.boards) - 1)]
            self.i += 1
            return [SquareLabel(b.piece_at(_c.parse_square(c.square)), 1.0) for c in crops]

    start = chess.Board()
    after = start.copy()
    after.push(chess.Move.from_uci("e2e4"))
    occ_start = [chess.square_name(sq) for sq in chess.SQUARES if start.piece_at(sq)]
    occ_after = [chess.square_name(sq) for sq in chess.SQUARES if after.piece_at(sq)]
    img_start, _ = render_board(square=32, margin=24, pieces=occ_start)
    img_after, _ = render_board(square=32, margin=24, pieces=occ_after)
    backend = FakeBackend([Monitor(0, 0, 0, img_start.shape[1], img_start.shape[0])], [img_start])
    tracker = Tracker(capturer=Capturer(backend=backend), classifier=SeqClassifier([start, after]))
    tracker.detect_position(img_start)
    ap = tracker.detect_position(img_after)
    assert ap is not None and ap.move == chess.Move.from_uci("e2e4")


def test_tracker_propagates_low_confidence():
    board = chess.Board()

    class LowConfClassifier:
        def __init__(self, board):
            self.board = board
        def classify(self, crops):
            out = []
            for c in crops:
                conf = 0.2 if c.square == "e2" else 1.0
                out.append(SquareLabel(self.board.piece_at(chess.parse_square(c.square)), conf))
            return out

    occupied = [chess.square_name(sq) for sq in chess.SQUARES if board.piece_at(sq)]
    img, _ = render_board(square=32, margin=24, pieces=occupied)
    backend = FakeBackend([Monitor(0, 0, 0, img.shape[1], img.shape[0])], [img])
    tracker = Tracker(capturer=Capturer(backend=backend), classifier=LowConfClassifier(board))
    ap = tracker.detect_position()
    assert ap is not None and "e2" in ap.low_confidence
