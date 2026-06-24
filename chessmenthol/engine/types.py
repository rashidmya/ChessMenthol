from __future__ import annotations

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
        return f"{(self.cp or 0) / 100:+.2f}"
