from __future__ import annotations

from typing import Optional, Protocol

import numpy as np

from .types import Frame, Monitor, Region


class CaptureBackend(Protocol):
    def list_monitors(self) -> list[Monitor]: ...
    def grab(self, region: Region) -> np.ndarray: ...


class MssBackend:
    """Real screen-capture backend using `mss`. Not exercised in headless CI."""

    def __init__(self) -> None:
        self._mss = None

    def _ensure(self):
        if self._mss is None:
            import mss

            self._mss = mss.mss()
        return self._mss

    def list_monitors(self) -> list[Monitor]:
        sct = self._ensure()
        # sct.monitors[0] is the virtual "all monitors" rect; real ones start at 1
        out: list[Monitor] = []
        for i, m in enumerate(sct.monitors[1:]):
            out.append(
                Monitor(
                    index=i,
                    left=m["left"],
                    top=m["top"],
                    width=m["width"],
                    height=m["height"],
                )
            )
        return out

    def grab(self, region: Region) -> np.ndarray:
        sct = self._ensure()
        shot = sct.grab(
            {
                "left": region.left,
                "top": region.top,
                "width": region.width,
                "height": region.height,
            }
        )
        bgra = np.asarray(shot)  # (H, W, 4) BGRA
        return np.ascontiguousarray(bgra[:, :, :3])  # -> BGR


class Capturer:
    """Selects a monitor/region and grabs frames, with change-detection."""

    def __init__(self, backend: Optional[CaptureBackend] = None) -> None:
        self._backend: CaptureBackend = backend if backend is not None else MssBackend()
        self._monitor: Optional[Monitor] = None
        self._region: Optional[Region] = None
        self._last_small: Optional[np.ndarray] = None

    def list_monitors(self) -> list[Monitor]:
        return self._backend.list_monitors()

    def select_monitor(self, index: int) -> None:
        monitors = self._backend.list_monitors()
        self._monitor = next(m for m in monitors if m.index == index)
        self._region = None

    def set_region(self, region: Optional[Region]) -> None:
        self._region = region

    def _active_region(self) -> Region:
        if self._region is not None:
            return self._region
        if self._monitor is not None:
            m = self._monitor
            return Region(m.left, m.top, m.width, m.height)
        raise RuntimeError("No monitor selected and no region set")

    def grab(self) -> Frame:
        region = self._active_region()
        image = self._backend.grab(region)
        return Frame(image=image, origin=(region.left, region.top))

    def grab_if_changed(self, threshold: float) -> Optional[Frame]:
        frame = self.grab()
        small = self._downsample(frame.image)
        if self._last_small is not None:
            diff = float(np.abs(small - self._last_small).mean())
            if diff < threshold:
                return None
        self._last_small = small
        return frame

    @staticmethod
    def _downsample(image: np.ndarray) -> np.ndarray:
        import cv2

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype(np.int16)
