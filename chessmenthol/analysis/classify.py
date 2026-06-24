from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

import chess

from ..engine.types import AnalysisInfo
from .book import BookLookup, NoBook


class MoveClass(str, Enum):
    BRILLIANT = "brilliant"
    GREAT = "great"
    BEST = "best"
    EXCELLENT = "excellent"
    GOOD = "good"
    BOOK = "book"
    INACCURACY = "inaccuracy"
    MISTAKE = "mistake"
    BLUNDER = "blunder"
    MISS = "miss"


@dataclass(frozen=True)
class Thresholds:
    excellent_max: int = 20       # cpl <= => excellent
    good_max: int = 50            # cpl <= => good
    inaccuracy_max: int = 100     # cpl <= => inaccuracy
    mistake_max: int = 250        # cpl <= => mistake (else blunder)
    great_gap: int = 150          # best better than 2nd-best by this => only-move
    brilliant_max_cpl: int = 30   # near-best ceiling to still be brilliant
    brilliant_keep: int = -50     # mover-POV eval after move must stay >= this
    sacrifice_min: int = 200      # (risked - gained) material to count as a sac
    miss_win: int = 200           # had at least this (mover POV) => was winning
    miss_keep: int = 100          # dropped below this => threw the win


PIECE_VALUE = {
    chess.PAWN: 100,
    chess.KNIGHT: 300,
    chess.BISHOP: 300,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 0,
}


def is_sacrifice(board_before: chess.Board, move: chess.Move,
                 thresholds: Optional[Thresholds] = None) -> bool:
    """Heuristic: did the move offer material on its destination square?

    v1 approximation: the moved piece lands on a square attacked by the
    opponent, and (value risked - value captured) is at least one minor piece.
    Does not run a full static-exchange evaluation; tunable via sacrifice_min.
    A square that is attacked but ALSO defended still counts as a sacrifice
    when the net risk exceeds sacrifice_min (no defender/SEE check in v1).
    """
    t = thresholds or Thresholds()
    mover = board_before.turn
    captured = board_before.piece_type_at(move.to_square)
    gain = PIECE_VALUE[captured] if captured else 0
    after = board_before.copy()
    after.push(move)
    moved_pt = after.piece_type_at(move.to_square)
    if moved_pt is None:
        return False
    risked = PIECE_VALUE[moved_pt]
    if after.is_attacked_by(not mover, move.to_square):
        return (risked - gain) >= t.sacrifice_min
    return False


@dataclass(frozen=True)
class Classification:
    label: MoveClass
    cpl: int            # centipawn loss vs best move, mover POV, >= 0
    is_best: bool


def classify_move(board_before: chess.Board, move: chess.Move,
                  analysis_before: AnalysisInfo, analysis_after: AnalysisInfo,
                  book: Optional[BookLookup] = None,
                  thresholds: Optional[Thresholds] = None) -> Classification:
    t = thresholds or Thresholds()
    bk = book or NoBook()
    mover_white = board_before.turn == chess.WHITE

    best_line = analysis_before.best
    if best_line is None or best_line.move is None:
        raise ValueError("analysis_before must contain at least one line with a move")
    best_move = best_line.move
    best_mover = best_line.eval.pov(mover_white)

    after_best = analysis_after.best
    if after_best is None:
        raise ValueError("analysis_after must contain at least one line")
    played_mover = after_best.eval.pov(mover_white)

    cpl = max(0, best_mover - played_mover)
    is_best = move == best_move

    second_gap = None
    if len(analysis_before.lines) >= 2:
        second_mover = analysis_before.lines[1].eval.pov(mover_white)
        second_gap = best_mover - second_mover

    # 1. Book moves are labelled regardless of quality.
    if bk.contains_move(board_before, move):
        return Classification(MoveClass.BOOK, cpl, is_best)

    # 2. Brilliant: near-best, a sound sacrifice, eval stays acceptable.
    near_best = cpl <= t.brilliant_max_cpl
    if (near_best
            and played_mover >= t.brilliant_keep
            and is_sacrifice(board_before, move, t)):
        return Classification(MoveClass.BRILLIANT, cpl, is_best)

    # 3. Great: the only move that holds (best by a wide margin).
    if is_best and second_gap is not None and second_gap >= t.great_gap:
        return Classification(MoveClass.GREAT, cpl, is_best)

    # 4. Plain best.
    if is_best:
        return Classification(MoveClass.BEST, cpl, is_best)

    # 5. Miss: a win was available and got thrown away.
    # v1 limitation: a missed FORCED MATE whose played move stays winning
    # (played_mover >= miss_keep) does NOT match here and falls through to the
    # CPL bands below, where it is labelled BLUNDER because cpl explodes when
    # best_mover is a mate score. Add a dedicated mate-miss threshold when tuning.
    if best_mover >= t.miss_win and played_mover < t.miss_keep:
        return Classification(MoveClass.MISS, cpl, is_best)

    # 6. Centipawn-loss bands.
    if cpl <= t.excellent_max:
        return Classification(MoveClass.EXCELLENT, cpl, is_best)
    if cpl <= t.good_max:
        return Classification(MoveClass.GOOD, cpl, is_best)
    if cpl <= t.inaccuracy_max:
        return Classification(MoveClass.INACCURACY, cpl, is_best)
    if cpl <= t.mistake_max:
        return Classification(MoveClass.MISTAKE, cpl, is_best)
    return Classification(MoveClass.BLUNDER, cpl, is_best)
