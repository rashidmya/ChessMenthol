from __future__ import annotations

import numpy as np

from chessmenthol.vision.types import Monitor


class FakeBackend:
    """Scripted CaptureBackend for headless tests (new grab_full Protocol)."""

    def __init__(self, monitors: list[Monitor], frames: list[np.ndarray]):
        self._monitors = monitors
        self._frames = list(frames)
        self.grab_calls = 0

    def list_monitors(self) -> list[Monitor]:
        return list(self._monitors)

    def grab_full(self) -> np.ndarray:
        frame = self._frames[min(self.grab_calls, len(self._frames) - 1)]
        self.grab_calls += 1
        return frame
