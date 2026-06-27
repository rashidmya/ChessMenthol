from __future__ import annotations

import numpy as np
import pytest

from chessmenthol.vision.capture import (
    Capturer,
    MssBackend,
    WaylandShotBackend,
    select_backend,
)
from chessmenthol.vision.types import Monitor, Region
from tests.vision.fakes import FakeBackend


def _monitors():
    return [Monitor(index=0, left=0, top=0, width=200, height=100)]


def test_list_monitors_delegates_to_backend():
    backend = FakeBackend(_monitors(), [np.zeros((100, 200, 3), np.uint8)])
    assert Capturer(backend=backend).list_monitors() == _monitors()


def test_grab_full_desktop_returns_whole_frame():
    img = np.arange(100 * 200 * 3, dtype=np.uint8).reshape(100, 200, 3)
    cap = Capturer(backend=FakeBackend(_monitors(), [img]))
    frame = cap.grab()
    assert frame.image.shape == (100, 200, 3)
    assert frame.origin == (0, 0)


def test_grab_crops_to_region_and_tags_origin():
    img = np.arange(100 * 200 * 3, dtype=np.uint8).reshape(100, 200, 3)
    cap = Capturer(backend=FakeBackend(_monitors(), [img]))
    cap.set_region(Region(10, 20, 40, 30))
    frame = cap.grab()
    assert frame.image.shape == (30, 40, 3)
    assert frame.origin == (10, 20)
    np.testing.assert_array_equal(frame.image, img[20:50, 10:50])


def test_grab_full_desktop_method_bypasses_region():
    img = np.zeros((100, 200, 3), np.uint8)
    cap = Capturer(backend=FakeBackend(_monitors(), [img]))
    cap.set_region(Region(10, 20, 40, 30))
    assert cap.grab_full_desktop().shape == (100, 200, 3)


def test_select_backend_wayland(monkeypatch):
    monkeypatch.setenv("XDG_SESSION_TYPE", "wayland")
    assert isinstance(select_backend(), WaylandShotBackend)


def test_select_backend_non_wayland(monkeypatch):
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    assert isinstance(select_backend(), MssBackend)


def test_wayland_backend_picks_first_available_cli():
    import cv2

    calls = {}

    def fake_which(binary):
        return "/usr/bin/grim" if binary == "grim" else None

    def fake_runner(cmd, check, timeout):
        calls["cmd"] = cmd
        cv2.imwrite(cmd[-1], np.full((10, 10, 3), 7, np.uint8))

    img = WaylandShotBackend(runner=fake_runner, which=fake_which).grab_full()
    assert img.shape == (10, 10, 3)
    assert calls["cmd"][0] == "grim"


def test_wayland_backend_errors_when_no_cli():
    be = WaylandShotBackend(runner=lambda *a, **k: None, which=lambda b: None)
    with pytest.raises(RuntimeError):
        be.grab_full()


def test_wayland_backend_prefers_spectacle_when_multiple_present():
    import cv2

    calls = {}

    def runner(cmd, check, timeout):
        calls["cmd"] = cmd
        cv2.imwrite(cmd[-1], np.zeros((4, 4, 3), np.uint8))

    be = WaylandShotBackend(runner=runner, which=lambda b: f"/usr/bin/{b}")
    be.grab_full()
    assert calls["cmd"][0] == "spectacle"
