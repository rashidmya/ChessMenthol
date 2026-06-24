import chess

from chessmenthol.analysis.classify import (
    MoveClass,
    Thresholds,
    is_sacrifice,
)


def test_moveclass_values_are_stable_strings():
    assert MoveClass.BRILLIANT.value == "brilliant"
    assert MoveClass.BLUNDER.value == "blunder"


def test_thresholds_have_sane_defaults():
    t = Thresholds()
    assert t.excellent_max < t.good_max < t.inaccuracy_max < t.mistake_max


def test_is_sacrifice_true_when_queen_moves_to_pawn_attacked_square():
    # Black pawn on g6 attacks f5 and h5. White queen d1 -> h5 (no capture).
    board = chess.Board("k7/8/6p1/8/8/8/8/3QK3 w - - 0 1")
    move = chess.Move.from_uci("d1h5")
    assert is_sacrifice(board, move) is True


def test_is_sacrifice_false_for_safe_queen_move():
    board = chess.Board("k7/8/6p1/8/8/8/8/3QK3 w - - 0 1")
    move = chess.Move.from_uci("d1d5")  # d5 not attacked
    assert is_sacrifice(board, move) is False


def test_is_sacrifice_false_for_equal_capture():
    # White queen captures a defended queen on h5: gain ~ risk, not a sac.
    board = chess.Board("k7/8/6p1/7q/8/8/8/3QK3 w - - 0 1")
    move = chess.Move.from_uci("d1h5")  # Qxh5, h5 attacked by g6 pawn
    assert is_sacrifice(board, move) is False
