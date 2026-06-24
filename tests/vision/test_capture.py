from __future__ import annotations

import numpy as np

from chessmenthol.vision.capture import Capturer
from chessmenthol.vision.types import Monitor, Region
from tests.vision.fakes import FakeBackend


def _monitors():
    return [Monitor(index=0, left=0, top=0, width=200, height=100)]


def test_list_monitors_delegates_to_backend():
    backend = FakeBackend(_monitors(), [np.zeros((100, 200, 3), np.uint8)])
    assert Capturer(backend=backend).list_monitors() == _monitors()


def test_grab_full_monitor_tags_origin():
    img = np.zeros((100, 200, 3), np.uint8)
    backend = FakeBackend(_monitors(), [img])
    cap = Capturer(backend=backend)
    cap.select_monitor(0)
    frame = cap.grab()
    assert frame.image.shape == (100, 200, 3)
    assert frame.origin == (0, 0)
    assert backend.grab_calls[0] == Region(0, 0, 200, 100)


def test_set_region_overrides_grab_area_and_origin():
    img = np.zeros((100, 200, 3), np.uint8)
    backend = FakeBackend(_monitors(), [img])
    cap = Capturer(backend=backend)
    cap.select_monitor(0)
    cap.set_region(Region(10, 20, 40, 30))
    cap.grab()
    assert backend.grab_calls[-1] == Region(10, 20, 40, 30)


def test_grab_if_changed_returns_none_when_identical():
    img = np.zeros((100, 200, 3), np.uint8)
    backend = FakeBackend(_monitors(), [img, img])
    cap = Capturer(backend=backend)
    cap.select_monitor(0)
    assert cap.grab_if_changed(threshold=1.0) is not None  # first frame always new
    assert cap.grab_if_changed(threshold=1.0) is None       # identical -> skipped


def test_grab_if_changed_returns_frame_when_changed():
    img_a = np.zeros((100, 200, 3), np.uint8)
    img_b = np.full((100, 200, 3), 255, np.uint8)
    backend = FakeBackend(_monitors(), [img_a, img_b])
    cap = Capturer(backend=backend)
    cap.select_monitor(0)
    assert cap.grab_if_changed(threshold=1.0) is not None
    assert cap.grab_if_changed(threshold=1.0) is not None
