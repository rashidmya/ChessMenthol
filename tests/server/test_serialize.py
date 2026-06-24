import chess

from chessmenthol.analysis.classify import Classification, MoveClass
from chessmenthol.engine.types import AnalysisInfo, Eval, Line
from chessmenthol.server.serialize import (
    analysis_to_dict,
    classification_to_dict,
    eval_to_dict,
    line_to_dict,
)


def test_eval_to_dict_cp_and_mate():
    assert eval_to_dict(Eval(cp=140)) == {"cp": 140, "mate": None, "text": "+1.40"}
    assert eval_to_dict(Eval(mate=3)) == {"cp": None, "mate": 3, "text": "#3"}


def test_line_to_dict_includes_uci_and_san():
    board = chess.Board()
    e4 = chess.Move.from_uci("e2e4")
    e5 = chess.Move.from_uci("e7e5")
    line = Line(multipv=1, eval=Eval(cp=20), depth=18, pv=[e4, e5])
    d = line_to_dict(line, board)
    assert d["multipv"] == 1
    assert d["scoreText"] == "+0.20"
    assert d["pv"] == ["e2e4", "e7e5"]
    assert d["san"] == "1. e4 e5"


def test_line_to_dict_empty_pv():
    board = chess.Board()
    d = line_to_dict(Line(multipv=1, eval=Eval(cp=0), depth=1, pv=[]), board)
    assert d["pv"] == []
    assert d["san"] == ""


def test_analysis_to_dict_shape():
    board = chess.Board()
    e4 = chess.Move.from_uci("e2e4")
    analysis = AnalysisInfo(board.fen(), 18, [Line(1, Eval(cp=30), 18, [e4])])
    d = analysis_to_dict(analysis, board)
    assert d["depth"] == 18
    assert d["eval"] == {"cp": 30, "mate": None, "text": "+0.30"}
    assert d["lines"][0]["pv"] == ["e2e4"]


def test_analysis_to_dict_no_lines_has_null_eval():
    d = analysis_to_dict(AnalysisInfo("x", 0, []), chess.Board())
    assert d["eval"] is None
    assert d["lines"] == []


def test_classification_to_dict():
    c = Classification(MoveClass.BRILLIANT, 0, True)
    assert classification_to_dict(c) == {"label": "brilliant", "cpl": 0, "isBest": True}
