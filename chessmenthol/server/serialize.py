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


PV_PLIES = 3  # plies of continuation to show after each move


def _continuation_san(board_after: chess.Board, pv: list[chess.Move], plies: int = PV_PLIES) -> str:
    """SAN of the first `plies` plies of `pv` from `board_after`, with a trailing
    ' …' when the real variation is longer. Empty string for an empty pv."""
    if not pv:
        return ""
    san = board_after.variation_san(pv[:plies])
    if len(pv) > plies:
        san += " …"
    return san


def last_move_to_dict(c: Classification, board_before: chess.Board, move: chess.Move,
                      before_a: AnalysisInfo, after_a: AnalysisInfo,
                      *, plies: int = PV_PLIES) -> dict:
    """Enriched `lastMove` payload comparing the played move to the engine's best.

    Preconditions (guaranteed by the caller): before_a.best, before_a.best.move,
    and after_a.best are not None. Evals are white-POV strings (e.g. "+5.03");
    continuations are
    numbered SAN truncated to `plies`. The best continuation drops the best move
    itself (it is already the row's name)."""
    best_line = before_a.best
    best_move = best_line.move
    after_played = board_before.copy()
    after_played.push(move)
    after_best = board_before.copy()
    after_best.push(best_move)
    return {
        "classification": classification_to_dict(c),
        "played": {
            "san": board_before.san(move),
            "uci": move.uci(),
            "evalText": after_a.best.eval.format_white(),
            "pv": _continuation_san(after_played, after_a.best.pv, plies),
        },
        "best": {
            "san": board_before.san(best_move),
            "uci": best_move.uci(),
            "evalText": best_line.eval.format_white(),
            "pv": _continuation_san(after_best, best_line.pv[1:], plies),
        },
    }


def region_shot_to_dict(image, max_width: int = 2560) -> dict:
    """A `region_shot` frame: a downscaled JPEG (base64) of the full desktop plus
    its TRUE pixel dimensions (so the client maps drag coords back to real pixels)."""
    import base64

    import cv2

    h, w = image.shape[:2]
    scale = min(1.0, max_width / w)
    disp = (
        image
        if scale >= 1.0
        else cv2.resize(image, (max(1, round(w * scale)), max(1, round(h * scale))),
                        interpolation=cv2.INTER_AREA)
    )
    ok, buf = cv2.imencode(".jpg", disp, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        raise RuntimeError("failed to encode region shot")
    return {
        "type": "region_shot",
        "jpegBase64": base64.b64encode(buf.tobytes()).decode(),
        "width": int(w),
        "height": int(h),
    }
