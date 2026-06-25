from __future__ import annotations

from chessmenthol.vision.types import Region


def iou(a: Region, b: Region) -> float:
    ix0, iy0 = max(a.left, b.left), max(a.top, b.top)
    ix1 = min(a.left + a.width, b.left + b.width)
    iy1 = min(a.top + a.height, b.top + b.height)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    union = a.width * a.height + b.width * b.height - inter
    return inter / union if union else 0.0
