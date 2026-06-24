import chess
import chess.engine

from chessmenthol.engine.types import Eval


def test_eval_from_cp_pov_score_is_white_relative():
    pov = chess.engine.PovScore(chess.engine.Cp(50), chess.WHITE)
    ev = Eval.from_pov_score(pov)
    assert ev.cp == 50
    assert ev.mate is None


def test_eval_from_black_cp_is_negated_to_white_pov():
    # +120 for the side to move (Black) -> -120 from White's POV
    pov = chess.engine.PovScore(chess.engine.Cp(120), chess.BLACK)
    ev = Eval.from_pov_score(pov)
    assert ev.cp == -120


def test_eval_from_mate():
    pov = chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE)
    ev = Eval.from_pov_score(pov)
    assert ev.mate == 3
    assert ev.cp is None


def test_scalar_maps_mate_near_mate_value():
    assert Eval(mate=3).scalar() == 100_000 - 3
    assert Eval(mate=-2).scalar() == -(100_000 - 2)
    assert Eval(cp=-45).scalar() == -45


def test_pov_flips_for_black_to_move():
    assert Eval(cp=80).pov(white_to_move=True) == 80
    assert Eval(cp=80).pov(white_to_move=False) == -80


def test_format_white():
    assert Eval(cp=140).format_white() == "+1.40"
    assert Eval(cp=-30).format_white() == "-0.30"
    assert Eval(mate=4).format_white() == "#4"
    assert Eval(mate=-1).format_white() == "#-1"
