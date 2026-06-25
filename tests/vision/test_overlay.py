from __future__ import annotations

import numpy as np

from chessmenthol.vision.detect import detect
from chessmenthol.vision.overlay import render_overlay
from chessmenthol.vision.types import Frame
from tests.vision.synthetic import render_board


def test_overlay_returns_same_shape_modified_image():
    img, _ = render_board(square=40, margin=24, highlights=["e2", "e4"])
    loc = detect(Frame(img))
    out = render_overlay(Frame(img), loc)
    assert out.shape == img.shape
    assert out.dtype == np.uint8
    # overlay draws on the image, so it must differ from the input
    assert not np.array_equal(out, img)


def test_overlay_does_not_mutate_input():
    img, _ = render_board(square=40, margin=24)
    loc = detect(Frame(img))
    before = img.copy()
    render_overlay(Frame(img), loc)
    assert np.array_equal(img, before)
