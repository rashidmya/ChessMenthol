from __future__ import annotations

import chess

from ..analysis.classify import Classification
from ..engine.types import AnalysisInfo, Eval, Line


def eval_to_dict(ev: Eval) -> dict:
    return {"cp": ev.cp, "mate": ev.mate, "text": ev.format_white()}


def line_to_dict(line: Line, board: chess.Board) -> dict:
    return {
        "multipv": line.multipv,
        "scoreText": line.eval.format_white(),
        "cp": line.eval.cp,
        "mate": line.eval.mate,
        "pv": [m.uci() for m in line.pv],
        "san": board.variation_san(line.pv) if line.pv else "",
    }


def analysis_to_dict(analysis: AnalysisInfo, board: chess.Board) -> dict:
    best = analysis.best
    return {
        "depth": analysis.depth,
        "eval": eval_to_dict(best.eval) if best is not None else None,
        "lines": [line_to_dict(line, board) for line in analysis.lines],
    }


def classification_to_dict(c: Classification) -> dict:
    return {"label": c.label.value, "cpl": c.cpl, "isBest": c.is_best}
