from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional, Union

import numpy as np

Orientation = Literal["white_bottom", "black_bottom"]


def square_name(col: int, row: int, orientation: Optional[str]) -> str:
    """Map geometric (col, row) — (0,0) at board top-left — to algebraic.

    Defaults to the white_bottom convention when orientation is None.
    """
    if orientation == "black_bottom":
        return f"{chr(ord('h') - col)}{row + 1}"
    return f"{chr(ord('a') + col)}{8 - row}"


@dataclass(frozen=True)
class Region:
    left: int
    top: int
    width: int
    height: int


@dataclass(frozen=True)
class Monitor:
    index: int
    left: int
    top: int
    width: int
    height: int


@dataclass
class Frame:
    """A captured image. `image` is BGR uint8 (H, W, 3); `origin` is the
    screen-space coordinate of the frame's top-left pixel."""

    image: np.ndarray
    origin: tuple[int, int] = (0, 0)


@dataclass(frozen=True)
class BoardLocation:
    bbox: Region
    grid_x: list[int]  # 9 vertical grid-line x-positions (left -> right)
    grid_y: list[int]  # 9 horizontal grid-line y-positions (top -> bottom)
    square_size: float
    orientation_hint: Optional[Orientation]
    highlight_squares: list[str] = field(default_factory=list)
    confidence: float = 0.0

    def cell_rect(self, col: int, row: int) -> Region:
        """Geometric cell rectangle; (col=0, row=0) is the board's top-left."""
        x0, x1 = self.grid_x[col], self.grid_x[col + 1]
        y0, y1 = self.grid_y[row], self.grid_y[row + 1]
        return Region(left=x0, top=y0, width=x1 - x0, height=y1 - y0)


@dataclass
class SquareImage:
    square: str  # provisional algebraic name, e.g. "e4"
    image: np.ndarray


# A captured Frame or a raw BGR ndarray — accepted interchangeably by the
# detection/overlay entry points.
ImageLike = Union[Frame, np.ndarray]


def as_image(frame: ImageLike) -> np.ndarray:
    """Return the underlying BGR ndarray from a Frame or a raw ndarray."""
    return frame.image if isinstance(frame, Frame) else frame
