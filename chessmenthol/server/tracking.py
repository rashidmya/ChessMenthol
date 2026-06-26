from __future__ import annotations

import logging
import threading
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# on_result receives an AssembledPosition or None each tick.
OnResult = Callable[[Optional[object]], None]


class TrackingLoop:
    """Daemon thread that polls a tracker while enabled. Per-tick work lives in
    `tick_once` so it can be driven directly (capture_now, tests) without a thread."""

    def __init__(
        self,
        tracker,
        on_result: OnResult,
        *,
        interval: float = 0.3,
        change_threshold: float = 2.0,
    ) -> None:
        self._tracker = tracker
        self._on_result = on_result
        self._interval = interval
        self._change_threshold = change_threshold
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    def tick_once(self) -> None:
        result = self._tracker.detect_position()
        self._on_result(result)

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                frame = self._tracker.grab_if_changed(self._change_threshold)
                if frame is not None:
                    self._on_result(self._tracker.detect_position(frame))
            except Exception as exc:
                logger.warning("tracking tick failed: %s", exc)
            self._stop.wait(self._interval)

    def stop(self) -> None:
        with self._lock:
            self._stop.set()
            thread = self._thread
            self._thread = None
        if thread is not None:
            thread.join(timeout=2.0)

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()
