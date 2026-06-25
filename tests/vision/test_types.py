from __future__ import annotations

import numpy as np

from chessmenthol.vision.types import (
    BoardLocation,
    Frame,
    Monitor,
    Region,
    SquareImage,
)


def test_region_and_monitor_construct():
    r = Region(left=10, top=20, width=80, height=80)
    assert (r.left, r.top, r.width, r.height) == (10, 20, 80, 80)
    m = Monitor(index=1, left=0, top=0, width=1920, height=1080)
    assert m.index == 1


def test_frame_defaults_origin():
    img = np.zeros((4, 4, 3), dtype=np.uint8)
    f = Frame(image=img)
    assert f.origin == (0, 0)
    assert f.image.shape == (4, 4, 3)


def test_board_location_cell_rect():
    grid_x = [0, 10, 20, 30, 40, 50, 60, 70, 80]
    grid_y = [0, 10, 20, 30, 40, 50, 60, 70, 80]
    loc = BoardLocation(
        bbox=Region(0, 0, 80, 80),
        grid_x=grid_x,
        grid_y=grid_y,
        square_size=10.0,
        orientation_hint="white_bottom",
        highlight_squares=[],
        confidence=1.0,
    )
    assert loc.cell_rect(0, 0) == Region(0, 0, 10, 10)
    assert loc.cell_rect(7, 7) == Region(70, 70, 10, 10)


def test_square_image_holds_name_and_array():
    s = SquareImage(square="e4", image=np.zeros((8, 8, 3), dtype=np.uint8))
    assert s.square == "e4"
    assert s.image.shape == (8, 8, 3)


from chessmenthol.vision.types import square_name


def test_square_name_in_types():
    assert square_name(0, 0, "white_bottom") == "a8"
    assert square_name(7, 7, "white_bottom") == "h1"
    assert square_name(0, 0, "black_bottom") == "h1"
    assert square_name(0, 0, None) == "a8"
