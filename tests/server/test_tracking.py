from __future__ import annotations

import threading
import time

from chessmenthol.server.tracking import TrackingLoop


class FakeTracker:
    def __init__(self, results):
        self._results = list(results)
        self.calls = 0

    def grab_if_changed(self, threshold):
        # Always return a non-None sentinel so _run proceeds to detect_position.
        return object()

    def detect_position(self, frame=None):
        self.calls += 1
        idx = min(self.calls - 1, len(self._results) - 1)
        return self._results[idx]


def test_tick_once_calls_on_result():
    seen = []
    loop = TrackingLoop(FakeTracker(["POS_A"]), on_result=seen.append)
    loop.tick_once()
    assert seen == ["POS_A"]


def test_tick_once_passes_none_through():
    seen = []
    loop = TrackingLoop(FakeTracker([None]), on_result=seen.append)
    loop.tick_once()
    assert seen == [None]


def test_start_runs_ticks_then_stop_joins():
    seen = []
    event = threading.Event()

    def on_result(r):
        seen.append(r)
        event.set()

    loop = TrackingLoop(FakeTracker(["X", "X", "X"]), on_result=on_result, interval=0.01)
    loop.start()
    assert event.wait(timeout=2.0), "expected at least one tick"
    loop.stop()
    assert not loop.is_running()
    assert len(seen) >= 1
