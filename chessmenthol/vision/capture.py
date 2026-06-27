from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable, Optional, Protocol

import numpy as np

from .types import Frame, Monitor, Region


class CaptureBackend(Protocol):
    def list_monitors(self) -> list[Monitor]: ...
    def grab_full(self) -> np.ndarray: ...  # whole virtual desktop, BGR (H, W, 3)


class MssBackend:
    """Direct screen grab via `mss` (X11/Windows/macOS). Black on Wayland."""

    def __init__(self) -> None:
        self._mss = None

    def _ensure(self):
        if self._mss is None:
            import mss

            self._mss = mss.mss()
        return self._mss

    def list_monitors(self) -> list[Monitor]:
        sct = self._ensure()
        out: list[Monitor] = []
        for i, m in enumerate(sct.monitors[1:]):
            out.append(Monitor(index=i, left=m["left"], top=m["top"],
                               width=m["width"], height=m["height"]))
        return out

    def grab_full(self) -> np.ndarray:
        sct = self._ensure()
        shot = sct.grab(sct.monitors[0])  # 0 = full virtual desktop
        bgra = np.asarray(shot)  # (H, W, 4) BGRA
        return np.ascontiguousarray(bgra[:, :, :3])  # -> BGR


class WaylandShotBackend:
    """Single-shot full-desktop grab on Wayland via a desktop screenshot CLI.

    `mss` returns black under Wayland (the compositor brokers capture), so we shell
    out to whichever screenshot binary the desktop ships. `runner`/`which` are
    injectable so tests never spawn a real process.
    """

    _CANDIDATES = [
        ("spectacle", ["spectacle", "-b", "-n", "-f", "-o", "{path}"]),
        ("grim", ["grim", "{path}"]),
        ("gnome-screenshot", ["gnome-screenshot", "-f", "{path}"]),
    ]

    def __init__(self, runner: Optional[Callable] = None, which: Optional[Callable] = None) -> None:
        self._runner = runner if runner is not None else subprocess.run
        self._which = which if which is not None else shutil.which
        self._template: Optional[list[str]] = None

    def _resolve(self) -> list[str]:
        if self._template is None:
            for binary, template in self._CANDIDATES:
                if self._which(binary):
                    self._template = template
                    break
            else:
                raise RuntimeError(
                    "no Wayland screenshot tool found "
                    "(install spectacle, grim, or gnome-screenshot)"
                )
        return self._template

    def list_monitors(self) -> list[Monitor]:
        return []  # Wayland clients can't portably enumerate outputs

    def grab_full(self) -> np.ndarray:
        import cv2

        template = self._resolve()
        tmp = Path(tempfile.gettempdir()) / "chessmenthol_shot.png"
        if tmp.exists():
            tmp.unlink()
        cmd = [arg.format(path=str(tmp)) for arg in template]
        self._runner(cmd, check=True, timeout=20)
        image = cv2.imread(str(tmp))
        if tmp.exists():
            tmp.unlink()
        if image is None:
            raise RuntimeError(f"screenshot tool produced no image: {cmd}")
        return image


def _is_wayland() -> bool:
    return (
        os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland"
        or bool(os.environ.get("WAYLAND_DISPLAY"))
    )


def select_backend() -> CaptureBackend:
    return WaylandShotBackend() if _is_wayland() else MssBackend()


class Capturer:
    """Grabs the full desktop via a backend and crops to the active region."""

    def __init__(self, backend: Optional[CaptureBackend] = None) -> None:
        self._backend: CaptureBackend = backend if backend is not None else select_backend()
        self._region: Optional[Region] = None

    def list_monitors(self) -> list[Monitor]:
        return self._backend.list_monitors()

    def select_monitor(self, index: int) -> None:
        """Convenience for the debug CLI: focus a monitor by cropping to its rect
        (relative to the virtual desktop; assumes the desktop origin is 0,0)."""
        m = next(x for x in self._backend.list_monitors() if x.index == index)
        self._region = Region(m.left, m.top, m.width, m.height)

    def set_region(self, region: Optional[Region]) -> None:
        self._region = region

    def grab_full_desktop(self) -> np.ndarray:
        return self._backend.grab_full()

    def grab(self) -> Frame:
        full = self._backend.grab_full()
        if self._region is None:
            return Frame(image=full, origin=(0, 0))
        r = self._region
        crop = full[r.top:r.top + r.height, r.left:r.left + r.width]
        return Frame(image=np.ascontiguousarray(crop), origin=(r.left, r.top))
