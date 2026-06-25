from __future__ import annotations

import pytest

from chessmenthol.vision.detect import detect
from chessmenthol.vision.types import Frame
from tests.vision.helpers import iou as _iou
from tests.vision.synthetic import render_board


# (square, margin)
GEOMETRY = [(24, 8), (32, 16), (40, 24), (56, 40), (64, 4)]
# (light_bgr, dark_bgr) themes
THEMES = [
    ((181, 217, 240), (99, 136, 181)),   # warm wood
    ((235, 235, 235), (120, 120, 120)),  # grey
    ((168, 184, 118), (90, 110, 60)),    # green
]
# a sparse mid-game-ish set of occupied squares
PIECES = ["e4", "d5", "g1", "b8", "a2", "h7", "c3", "f6"]


@pytest.mark.parametrize("square,margin", GEOMETRY)
def test_detect_geometry_variants(square, margin):
    img, truth = render_board(square=square, margin=margin)
    loc = detect(Frame(img))
    assert loc is not None
    assert _iou(loc.bbox, truth.bbox) > 0.95


@pytest.mark.parametrize("light,dark", THEMES)
def test_detect_theme_variants(light, dark):
    img, truth = render_board(square=40, margin=24, light=light, dark=dark)
    loc = detect(Frame(img))
    assert loc is not None
    assert _iou(loc.bbox, truth.bbox) > 0.95


def test_detect_survives_pieces():
    img, truth = render_board(square=40, margin=24, pieces=PIECES)
    loc = detect(Frame(img))
    assert loc is not None
    assert _iou(loc.bbox, truth.bbox) > 0.95
    assert loc.confidence > 0.4


def test_detect_survives_starting_position():
    start = [f"{file}{rank}" for rank in (1, 2, 7, 8) for file in "abcdefgh"]
    img, truth = render_board(square=40, margin=24, pieces=start)
    loc = detect(Frame(img))
    assert loc is not None
    assert _iou(loc.bbox, truth.bbox) > 0.95
