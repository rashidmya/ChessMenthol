import chess

from chessmenthol.analysis.classify import Classification, MoveClass
from chessmenthol.engine.types import AnalysisInfo, Eval, Line
from chessmenthol.server.serialize import (
    analysis_to_dict,
    classification_to_dict,
    eval_to_dict,
    last_move_to_dict,
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


def _line(cp, ucis, depth=20):
    return Line(1, Eval(cp=cp), depth, [chess.Move.from_uci(u) for u in ucis])


def test_last_move_to_dict_best_not_played():
    board = chess.Board()
    move = chess.Move.from_uci("a2a3")
    before = AnalysisInfo(board.fen(), 20,
                          [_line(227, ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"])])
    after_board = board.copy()
    after_board.push(move)
    after = AnalysisInfo(after_board.fen(), 20, [_line(503, ["e7e5", "g1f3"])])
    c = Classification(MoveClass.MISTAKE, 276, False)

    d = last_move_to_dict(c, board, move, before, after)

    assert d["classification"] == {"label": "mistake", "cpl": 276, "isBest": False}
    assert d["played"] == {"san": "a3", "evalText": "+5.03", "pv": "1...e5 2. Nf3"}
    assert d["best"] == {
        "san": "e4", "uci": "e2e4", "evalText": "+2.27",
        "pv": "1...e5 2. Nf3 Nc6 …",
    }


def test_last_move_to_dict_best_played_single():
    board = chess.Board()
    move = chess.Move.from_uci("e2e4")
    before = AnalysisInfo(board.fen(), 20, [_line(30, ["e2e4", "e7e5", "g1f3"])])
    after_board = board.copy()
    after_board.push(move)
    after = AnalysisInfo(after_board.fen(), 20, [_line(28, ["e7e5", "g1f3"])])
    c = Classification(MoveClass.BEST, 0, True)

    d = last_move_to_dict(c, board, move, before, after)

    assert d["classification"]["isBest"] is True
    assert d["best"] == {"san": "e4", "uci": "e2e4", "evalText": "+0.30",
                         "pv": "1...e5 2. Nf3"}
    assert d["played"]["san"] == "e4"
    assert d["played"]["evalText"] == "+0.28"
    assert d["played"]["pv"] == "1...e5 2. Nf3"


def test_last_move_to_dict_empty_continuation():
    board = chess.Board()
    move = chess.Move.from_uci("a2a3")
    before = AnalysisInfo(board.fen(), 20, [_line(50, ["e2e4"])])  # best move, no follow-up
    after_board = board.copy()
    after_board.push(move)
    after = AnalysisInfo(after_board.fen(), 20, [Line(1, Eval(cp=40), 20, [])])  # no pv
    c = Classification(MoveClass.INACCURACY, 10, False)

    d = last_move_to_dict(c, board, move, before, after)

    assert d["best"]["pv"] == ""    # before.best.pv[1:] is empty
    assert d["played"]["pv"] == ""  # after.best.pv is empty
