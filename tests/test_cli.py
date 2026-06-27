import chess
import pytest

from chessmenthol.cli import build_parser, format_lines, format_report, run
from chessmenthol.analysis.classify import Classification, MoveClass
from chessmenthol.engine.types import AnalysisInfo, Eval, Line


def test_parser_requires_fen():
    with pytest.raises(SystemExit):
        build_parser().parse_args([])


def test_parser_defaults():
    args = build_parser().parse_args(["--fen", chess.STARTING_FEN])
    assert args.depth == 18
    assert args.lines == 3
    assert args.engine == "stockfish"


def test_parser_rejects_unknown_engine():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--fen", chess.STARTING_FEN, "--engine", "komodo"])


def test_format_report_renders_eval_san_and_class():
    board = chess.Board()
    e4 = chess.Move.from_uci("e2e4")
    analysis = AnalysisInfo(board.fen(), 20, [Line(1, Eval(cp=30), 20, [e4])])
    classification = Classification(MoveClass.BEST, 0, True)
    text = format_report(board, analysis, classification)
    assert "+0.30" in text
    assert "e4" in text
    assert "best" in text


def test_format_report_without_classification():
    board = chess.Board()
    analysis = AnalysisInfo(board.fen(), 12, [Line(1, Eval(mate=2), 12,
                            [chess.Move.from_uci("e2e4")])])
    text = format_report(board, analysis, None)
    assert "+M2" in text
    assert "Move class" not in text


@pytest.mark.engine
def test_run_end_to_end_smoke(capsys):
    code = run(["--fen", chess.STARTING_FEN, "--depth", "8", "--lines", "2"])
    out = capsys.readouterr().out
    assert code == 0
    assert "Lines:" in out


def test_format_lines_handles_empty_pv():
    board = chess.Board()
    analysis = AnalysisInfo(board.fen(), 10, [Line(1, Eval(cp=0), 10, [])])
    text = format_lines(board, analysis)
    assert "[1]" in text
    assert "+0.00" in text


@pytest.mark.engine
def test_run_classifies_played_move(capsys):
    start = chess.STARTING_FEN
    after_e4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    code = run(["--fen", after_e4, "--depth", "8", "--lines", "2",
                "--prev-fen", start, "--move", "e2e4"])
    out = capsys.readouterr().out
    assert code == 0
    assert "Move class:" in out


def test_run_rejects_inconsistent_fen():
    # --fen is the start position but prev+move implies the after-e4 position
    with pytest.raises(SystemExit):
        run(["--fen", chess.STARTING_FEN,
             "--prev-fen", chess.STARTING_FEN, "--move", "e2e4"])
