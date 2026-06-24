from __future__ import annotations

import numpy as np

from chessmenthol.vision.types import Monitor, Region


class FakeBackend:
    """Scripted CaptureBackend for headless tests."""

    def __init__(self, monitors: list[Monitor], frames: list[np.ndarray]):
        self._monitors = monitors
        self._frames = list(frames)
        self.grab_calls: list[Region] = []

    def list_monitors(self) -> list[Monitor]:
        return list(self._monitors)

    def grab(self, region: Region) -> np.ndarray:
        self.grab_calls.append(region)
        # cycle through scripted frames
        frame = self._frames[min(len(self.grab_calls) - 1, len(self._frames) - 1)]
        return frame
