from __future__ import annotations

import numpy as np

from chessmenthol.vision.detect import detect, square_name
from chessmenthol.vision.types import Frame
from tests.vision.synthetic import render_board


def _iou(a, b) -> float:
    ax0, ay0, ax1, ay1 = a.left, a.top, a.left + a.width, a.top + a.height
    bx0, by0, bx1, by1 = b.left, b.top, b.left + b.width, b.top + b.height
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    union = a.width * a.height + b.width * b.height - inter
    return inter / union if union else 0.0


def test_detect_clean_board_bbox_iou():
    img, truth = render_board(square=40, margin=24)
    loc = detect(Frame(img))
    assert loc is not None
    assert _iou(loc.bbox, truth.bbox) > 0.95
    assert len(loc.grid_x) == 9 and len(loc.grid_y) == 9
    assert abs(loc.square_size - 40.0) <= 2.0
    assert loc.confidence > 0.6


def test_detect_no_margin_board():
    img, truth = render_board(square=40, margin=0)
    loc = detect(Frame(img))
    assert loc is not None
    assert _iou(loc.bbox, truth.bbox) > 0.90


def test_detect_accepts_plain_ndarray():
    img, _ = render_board(square=32, margin=16)
    assert detect(img) is not None


def test_detect_returns_none_on_noise():
    rng = np.random.default_rng(0)
    noise = rng.integers(0, 255, size=(300, 300, 3), dtype=np.uint8)
    assert detect(noise) is None


def test_square_name_white_bottom():
    assert square_name(0, 0, "white_bottom") == "a8"
    assert square_name(7, 7, "white_bottom") == "h1"


def test_square_name_black_bottom():
    assert square_name(0, 0, "black_bottom") == "h1"
    assert square_name(7, 7, "black_bottom") == "a8"


def test_square_name_none_orientation_defaults_to_white_bottom():
    assert square_name(0, 0, None) == "a8"
    assert square_name(7, 7, None) == "h1"
