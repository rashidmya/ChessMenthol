from __future__ import annotations

import numpy as np

from tests.vision.synthetic import render_board


def test_render_board_geometry_matches_ground_truth():
    img, truth = render_board(square=32, margin=16)
    assert img.shape == (32 * 8 + 32, 32 * 8 + 32, 3)  # margin on both sides
    assert img.dtype == np.uint8
    assert truth.bbox.left == 16 and truth.bbox.top == 16
    assert truth.bbox.width == 256 and truth.bbox.height == 256
    assert truth.grid_x == [16, 48, 80, 112, 144, 176, 208, 240, 272]
    assert truth.square_size == 32.0


def test_render_board_cells_alternate_colors():
    img, truth = render_board(square=32, margin=16)
    c00 = img[truth.grid_y[0] + 16, truth.grid_x[0] + 16]
    c01 = img[truth.grid_y[0] + 16, truth.grid_x[1] + 16]
    assert not np.array_equal(c00, c01)


def test_render_board_orientation_hint_white_bottom():
    _, truth = render_board(square=32, margin=16)
    assert truth.orientation_hint == "white_bottom"


def test_render_board_highlights_recorded():
    _, truth = render_board(square=32, margin=16, highlights=["e2", "e4"])
    assert set(truth.highlight_squares) == {"e2", "e4"}
