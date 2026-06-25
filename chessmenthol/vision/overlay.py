from __future__ import annotations

import cv2
import numpy as np

from .detect import square_name
from .types import BoardLocation, ImageLike, as_image

_GREEN = (0, 255, 0)
_YELLOW = (0, 255, 255)
_RED = (0, 0, 255)


def render_overlay(frame: ImageLike, location: BoardLocation) -> np.ndarray:
    out = as_image(frame).copy()
    b = location.bbox
    cv2.rectangle(out, (b.left, b.top), (b.left + b.width, b.top + b.height), _GREEN, 2)
    for x in location.grid_x:
        cv2.line(out, (x, b.top), (x, b.top + b.height), _GREEN, 1)
    for y in location.grid_y:
        cv2.line(out, (b.left, y), (b.left + b.width, y), _GREEN, 1)

    for row in range(8):
        for col in range(8):
            name = square_name(col, row, location.orientation_hint)
            x0, y0 = location.grid_x[col], location.grid_y[row]
            if name in location.highlight_squares:
                x1, y1 = location.grid_x[col + 1], location.grid_y[row + 1]
                cv2.rectangle(out, (x0, y0), (x1, y1), _YELLOW, 2)
            cv2.putText(
                out, name, (x0 + 2, y0 + 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.3, _RED, 1, cv2.LINE_AA,
            )

    header = f"conf={location.confidence:.2f} orient={location.orientation_hint}"
    cv2.putText(out, header, (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, _RED, 2, cv2.LINE_AA)
    return out
