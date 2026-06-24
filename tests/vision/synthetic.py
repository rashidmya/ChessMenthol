from __future__ import annotations

import numpy as np

from chessmenthol.vision.types import BoardLocation, Region

# BGR colors
_LIGHT = (181, 217, 240)   # light square
_DARK = (99, 136, 181)     # dark square
_BG = (60, 60, 60)         # page background
_HIGHLIGHT = (90, 200, 230)  # tinted highlight overlay color (BGR)


def _square_to_colrow(square: str) -> tuple[int, int]:
    """Algebraic -> geometric (col, row) under white_bottom."""
    col = ord(square[0]) - ord("a")
    row = 8 - int(square[1])
    return col, row


def render_board(
    *,
    square: int = 32,
    margin: int = 16,
    light: tuple[int, int, int] = _LIGHT,
    dark: tuple[int, int, int] = _DARK,
    bg: tuple[int, int, int] = _BG,
    pieces: list[str] | None = None,
    highlights: list[str] | None = None,
) -> tuple[np.ndarray, BoardLocation]:
    """Render an axis-aligned board. Returns (BGR image, ground-truth location).

    Deterministic — all variation comes from explicit parameters. `pieces` and
    `highlights` are algebraic square names under the white_bottom convention.
    """
    board_px = square * 8
    canvas = margin * 2 + board_px
    img = np.empty((canvas, canvas, 3), dtype=np.uint8)
    img[:, :] = bg

    for row in range(8):
        for col in range(8):
            x0 = margin + col * square
            y0 = margin + row * square
            # (col+row) even -> light at top-left so bottom-left (row7,col0) is dark
            color = light if (col + row) % 2 == 0 else dark
            img[y0 : y0 + square, x0 : x0 + square] = color

    if highlights:
        for sq in highlights:
            col, row = _square_to_colrow(sq)
            x0 = margin + col * square
            y0 = margin + row * square
            cell = img[y0 : y0 + square, x0 : x0 + square].astype(np.float32)
            tint = np.array(_HIGHLIGHT, dtype=np.float32)
            img[y0 : y0 + square, x0 : x0 + square] = (
                0.5 * cell + 0.5 * tint
            ).astype(np.uint8)

    if pieces:
        import cv2

        for sq in pieces:
            col, row = _square_to_colrow(sq)
            cx = margin + col * square + square // 2
            cy = margin + row * square + square // 2
            cv2.circle(img, (cx, cy), square // 3, (20, 20, 20), -1)

    grid_x = [margin + i * square for i in range(9)]
    grid_y = [margin + i * square for i in range(9)]
    truth = BoardLocation(
        bbox=Region(margin, margin, board_px, board_px),
        grid_x=grid_x,
        grid_y=grid_y,
        square_size=float(square),
        orientation_hint="white_bottom",
        highlight_squares=list(highlights or []),
        confidence=1.0,
    )
    return img, truth
