import chess

from chessmenthol.analysis.classify import (
    Classification,
    MoveClass,
    Thresholds,
    classify_move,
    is_sacrifice,
)
from chessmenthol.engine.types import AnalysisInfo, Eval, Line


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


def mk_analysis(fen, lines, depth=20):
    """lines: list of (Eval, [moves]) in best-first order."""
    objs = [Line(multipv=i + 1, eval=ev, depth=depth, pv=pv)
            for i, (ev, pv) in enumerate(lines)]
    return AnalysisInfo(fen=fen, depth=depth, lines=objs)


def _white_startpos_move(uci):
    board = chess.Board()
    move = chess.Move.from_uci(uci)
    after = board.copy()
    after.push(move)
    return board, move, after


def test_best_move_is_classified_best():
    board, e4, after = _white_startpos_move("e2e4")
    d4 = chess.Move.from_uci("d2d4")
    before = mk_analysis(board.fen(), [(Eval(cp=30), [e4]), (Eval(cp=15), [d4])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=30), [chess.Move.from_uci("e7e5")])])
    result = classify_move(board, e4, before, after_a)
    assert result.label == MoveClass.BEST
    assert result.is_best is True
    assert result.cpl == 0


def test_blunder_when_eval_collapses():
    board, e4, after = _white_startpos_move("e2e4")
    best = chess.Move.from_uci("d2d4")
    before = mk_analysis(board.fen(), [(Eval(cp=50), [best]), (Eval(cp=20), [e4])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=-300), [chess.Move.from_uci("e7e5")])])
    result = classify_move(board, e4, before, after_a)
    assert result.label == MoveClass.BLUNDER
    assert result.is_best is False
    assert result.cpl == 350


def test_inaccuracy_band():
    board, e4, after = _white_startpos_move("e2e4")
    best = chess.Move.from_uci("d2d4")
    before = mk_analysis(board.fen(), [(Eval(cp=90), [best]), (Eval(cp=20), [e4])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=10), [chess.Move.from_uci("e7e5")])])
    result = classify_move(board, e4, before, after_a)  # cpl = 80
    assert result.label == MoveClass.INACCURACY


def test_book_move_short_circuits():
    board, e4, after = _white_startpos_move("e2e4")
    before = mk_analysis(board.fen(), [(Eval(cp=30), [e4])])
    after_a = mk_analysis(after.fen(), [(Eval(cp=30), [chess.Move.from_uci("e7e5")])])

    class AlwaysBook:
        def contains_move(self, b, m):
            return True

    result = classify_move(board, e4, before, after_a, book=AlwaysBook())
    assert result.label == MoveClass.BOOK
