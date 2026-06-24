from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import List, Optional

import chess
import chess.engine


@dataclass(frozen=True)
class Eval:
    """A position evaluation, always from White's point of view."""

    cp: Optional[int] = None    # centipawns (None when it is a forced mate)
    mate: Optional[int] = None  # mate-in-N; positive = White mates

    @classmethod
    def from_pov_score(cls, pov: "chess.engine.PovScore") -> "Eval":
        white = pov.white()
        if white.is_mate():
            return cls(cp=None, mate=white.mate())
        return cls(cp=white.score(), mate=None)

    def scalar(self, mate_value: int = 100_000) -> int:
        """White-POV centipawn scalar; mate mapped near +/- mate_value."""
        if self.mate is not None:
            base = mate_value - abs(self.mate)
            return base if self.mate > 0 else -base
        return self.cp if self.cp is not None else 0

    def pov(self, white_to_move: bool, mate_value: int = 100_000) -> int:
        """Scalar from the perspective of the side to move."""
        s = self.scalar(mate_value)
        return s if white_to_move else -s

    def format_white(self) -> str:
        if self.mate is not None:
            return f"#{self.mate}"
        return f"{(self.cp if self.cp is not None else 0) / 100:+.2f}"


@dataclass(frozen=True)
class Line:
    """One principal variation from a multi-PV analysis."""

    multipv: int            # 1-based rank; 1 == best line
    eval: Eval
    depth: int
    pv: List[chess.Move]    # mutable list field => Line is frozen but NOT hashable

    @property
    def move(self) -> Optional[chess.Move]:
        return self.pv[0] if self.pv else None


@dataclass(frozen=True)
class AnalysisInfo:
    """A full analysis snapshot of one position."""

    fen: str
    depth: int
    lines: List[Line]       # sorted ascending by multipv (lines[0] == best); not hashable

    @property
    def best(self) -> Optional[Line]:
        return self.lines[0] if self.lines else None

    @classmethod
    def from_engine(cls, fen: str, infos: "Iterable[chess.engine.InfoDict]") -> "AnalysisInfo":
        lines: List[Line] = []
        for info in infos:
            lines.append(
                Line(
                    multipv=info.get("multipv", 1),
                    eval=Eval.from_pov_score(info["score"]),
                    depth=info.get("depth", 0),
                    pv=list(info.get("pv", [])),
                )
            )
        lines.sort(key=lambda l: l.multipv)
        depth = max((l.depth for l in lines), default=0)
        return cls(fen=fen, depth=depth, lines=lines)
