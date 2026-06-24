import chess
import chess.engine

from chessmenthol.engine.types import AnalysisInfo, Eval, Line


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
    pov_b = chess.engine.PovScore(chess.engine.Mate(2), chess.BLACK)
    ev_b = Eval.from_pov_score(pov_b)
    assert ev_b.mate == -2
    assert ev_b.cp is None


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


def _info(multipv, score, pv, depth=20):
    return {"multipv": multipv, "score": score, "pv": pv, "depth": depth}


def test_line_move_is_first_pv_move():
    mv = chess.Move.from_uci("e2e4")
    line = Line(multipv=1, eval=Eval(cp=30), depth=20, pv=[mv])
    assert line.move == mv


def test_line_move_is_none_when_pv_empty():
    assert Line(multipv=1, eval=Eval(cp=0), depth=1, pv=[]).move is None


def test_analysis_from_engine_sorts_by_multipv_and_picks_best():
    e4 = chess.Move.from_uci("e2e4")
    d4 = chess.Move.from_uci("d2d4")
    infos = [
        _info(2, chess.engine.PovScore(chess.engine.Cp(10), chess.WHITE), [d4], 18),
        _info(1, chess.engine.PovScore(chess.engine.Cp(30), chess.WHITE), [e4], 20),
    ]
    analysis = AnalysisInfo.from_engine(chess.Board().fen(), infos)
    assert [l.multipv for l in analysis.lines] == [1, 2]
    assert analysis.best.move == e4
    assert analysis.depth == 20


def test_analysis_best_is_none_when_no_lines():
    assert AnalysisInfo(fen="x", depth=0, lines=[]).best is None
