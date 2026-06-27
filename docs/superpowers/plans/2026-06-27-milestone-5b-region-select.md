# Milestone 5b — Region Select — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag a rectangle over a fullscreen screenshot to focus screen capture on the chess board, captured on demand, working on every OS including Wayland.

**Architecture:** One `grab_full_desktop()` primitive with two backends (`mss` for X11/Win/macOS; a screenshot-CLI backend for Wayland). The `Capturer` owns region cropping. Region selection is a custom fullscreen web overlay that yields desktop-pixel coordinates; capture is on-demand only. All M4c continuous-tracking machinery is removed.

**Tech Stack:** Python (`mss`, `opencv-python-headless`, `numpy`, `python-chess`, FastAPI), Svelte 5 + TS + Vitest, `chessground`. **No new dependency.**

Spec: `docs/superpowers/specs/2026-06-27-milestone-5b-region-select-design.md`.

**Refinement of the spec (already reflected in the spec):** the Wayland grab uses a screenshot CLI (`spectacle`/`grim`/`gnome-screenshot`), not the portal D-Bus path — zero new dependency, simpler, and PyInstaller-clean. Portal-via-D-Bus is a documented future enhancement.

**Run tests:** Python `.venv/bin/pytest -q`; frontend `cd frontend && npm run test`.

---

### Task 0: Wayland screenshot-CLI spike (manual de-risk)

**Files:**
- Create (gitignored): `.superpowers/brainstorm/m5b/spike_wayland_shot.py`

This confirms the only OS-dependent piece before any code depends on it. It is a throwaway under the gitignored brainstorm dir — never committed.

- [ ] **Step 1: Write the spike**

```python
# .superpowers/brainstorm/m5b/spike_wayland_shot.py
import shutil, subprocess, tempfile
from pathlib import Path
import cv2

CANDIDATES = [
    ("spectacle", ["spectacle", "-b", "-n", "-f", "-o", "{path}"]),
    ("grim", ["grim", "{path}"]),
    ("gnome-screenshot", ["gnome-screenshot", "-f", "{path}"]),
]
for binary, template in CANDIDATES:
    if shutil.which(binary):
        tmp = Path(tempfile.gettempdir()) / "cm_spike.png"
        cmd = [a.format(path=str(tmp)) for a in template]
        subprocess.run(cmd, check=True, timeout=20)
        img = cv2.imread(str(tmp))
        std = None if img is None else float(img.std())
        print(f"{binary}: shape={None if img is None else img.shape} std={std}")
        print("VERDICT:", "REAL pixels" if (img is not None and std > 2) else "BLACK/empty")
        break
else:
    print("no screenshot CLI found")
```

- [ ] **Step 2: Run it and observe**

Run: `.venv/bin/python .superpowers/brainstorm/m5b/spike_wayland_shot.py`
Expected: prints the chosen binary and `VERDICT: REAL pixels` (no GUI window pops up). On the dev machine this is `spectacle`. If it shows a GUI or returns BLACK, note which binary and adjust the candidate order in Task 1.

- [ ] **Step 3: No commit** (spike is gitignored).

---

### Task 1: Capture backends + Capturer refactor

**Files:**
- Modify: `chessmenthol/vision/capture.py` (full rewrite)
- Modify: `tests/vision/fakes.py`
- Test: `tests/vision/test_capture.py` (full rewrite)

- [ ] **Step 1: Update the test fake to the new Protocol**

Replace `tests/vision/fakes.py` with:

```python
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
```

- [ ] **Step 2: Write the failing capture tests**

Replace `tests/vision/test_capture.py` with:

```python
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
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest tests/vision/test_capture.py -q`
Expected: FAIL — `ImportError` (`WaylandShotBackend`, `select_backend` not defined).

- [ ] **Step 4: Rewrite `chessmenthol/vision/capture.py`**

```python
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
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest tests/vision/test_capture.py -q`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/vision/capture.py tests/vision/fakes.py tests/vision/test_capture.py
git commit -m "feat(vision): grab_full_desktop backends + Capturer region crop; add WaylandShotBackend"
```

---

### Task 2: Tracker — drop continuous helpers, add region passthrough

**Files:**
- Modify: `chessmenthol/vision/tracker.py`
- Test: `tests/vision/test_tracker.py` (one new test; rest pass unchanged via the updated fake)

- [ ] **Step 1: Write a failing test for the region passthrough**

Append to `tests/vision/test_tracker.py`:

```python
def test_tracker_grab_full_desktop_and_set_region_delegate():
    import numpy as np
    from chessmenthol.vision.types import Region

    img = np.full((20, 30, 3), 5, np.uint8)
    backend = FakeBackend([Monitor(0, 0, 0, 30, 20)], [img])
    tracker = Tracker(capturer=Capturer(backend=backend), classifier=FakeClassifier(chess.Board()))
    assert tracker.grab_full_desktop().shape == (20, 30, 3)
    tracker.set_region(Region(1, 2, 4, 5))  # must not raise; stored on the capturer
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/vision/test_tracker.py::test_tracker_grab_full_desktop_and_set_region_delegate -q`
Expected: FAIL — `AttributeError: 'Tracker' object has no attribute 'grab_full_desktop'`.

- [ ] **Step 3: Edit `chessmenthol/vision/tracker.py`**

In `Tracker.__init__`, **delete** the line `self._capturer.select_monitor(0)  # default: full primary monitor` (default is now the whole desktop, region `None`).

**Delete** the `grab_if_changed` method:
```python
    def grab_if_changed(self, threshold: float):
        return self._capturer.grab_if_changed(threshold)
```

**Add** these two methods (next to `reset`):
```python
    def set_region(self, region) -> None:
        self._capturer.set_region(region)

    def grab_full_desktop(self):
        return self._capturer.grab_full_desktop()
```

- [ ] **Step 4: Run the full tracker suite**

Run: `.venv/bin/pytest tests/vision/test_tracker.py -q`
Expected: PASS (the new test plus all existing tracker tests, which never used `grab_if_changed`).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/vision/tracker.py tests/vision/test_tracker.py
git commit -m "feat(vision): Tracker region passthrough; drop grab_if_changed + monitor default"
```

---

### Task 3: Delete the continuous TrackingLoop

**Files:**
- Delete: `chessmenthol/server/tracking.py`
- Delete: `tests/server/test_tracking.py`

- [ ] **Step 1: Delete both files**

```bash
git rm chessmenthol/server/tracking.py tests/server/test_tracking.py
```

- [ ] **Step 2: Confirm nothing else imports it**

Run: `grep -rn "tracking import\|TrackingLoop\|grab_if_changed" chessmenthol tests`
Expected: the only remaining hit is `chessmenthol/server/orchestrator.py` (fixed in Task 5). If `grep` finds others, note them.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(server): remove continuous TrackingLoop (on-demand capture only)"
```

---

### Task 4: `region_shot` serializer

**Files:**
- Modify: `chessmenthol/server/serialize.py`
- Test: `tests/server/test_serialize.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/server/test_serialize.py`:

```python
def test_region_shot_to_dict_carries_true_dims_and_jpeg():
    import numpy as np
    from chessmenthol.server.serialize import region_shot_to_dict

    img = np.zeros((40, 80, 3), np.uint8)
    frame = region_shot_to_dict(img, max_width=40)  # force a downscale
    assert frame["type"] == "region_shot"
    assert frame["width"] == 80 and frame["height"] == 40  # TRUE dims, not downscaled
    assert isinstance(frame["jpegBase64"], str) and len(frame["jpegBase64"]) > 0
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/server/test_serialize.py::test_region_shot_to_dict_carries_true_dims_and_jpeg -q`
Expected: FAIL — `ImportError: cannot import name 'region_shot_to_dict'`.

- [ ] **Step 3: Add the serializer to `chessmenthol/server/serialize.py`**

Append:
```python
def region_shot_to_dict(image, max_width: int = 2560) -> dict:
    """A `region_shot` frame: a downscaled JPEG (base64) of the full desktop plus
    its TRUE pixel dimensions (so the client maps drag coords back to real pixels)."""
    import base64

    import cv2

    h, w = image.shape[:2]
    scale = min(1.0, max_width / w)
    disp = (
        image
        if scale >= 1.0
        else cv2.resize(image, (max(1, round(w * scale)), max(1, round(h * scale))),
                        interpolation=cv2.INTER_AREA)
    )
    ok, buf = cv2.imencode(".jpg", disp, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        raise RuntimeError("failed to encode region shot")
    return {
        "type": "region_shot",
        "jpegBase64": base64.b64encode(buf.tobytes()).decode(),
        "width": int(w),
        "height": int(h),
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/server/test_serialize.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/server/serialize.py tests/server/test_serialize.py
git commit -m "feat(server): add region_shot serializer (downscaled jpeg + true dims)"
```

---

### Task 5: Orchestrator — on-demand vision commands, remove tracking

**Files:**
- Modify: `chessmenthol/server/orchestrator.py`
- Test: `tests/server/test_orchestrator.py` (vision section)

This task replaces the entire vision/tracking surface of the orchestrator. Work in two commits: first the server code, then the tests.

- [ ] **Step 1: Edit `chessmenthol/server/orchestrator.py` — imports & constants**

At the top, **remove** `from .tracking import TrackingLoop` and the `_PAUSE_ON_TRACKING` constant. Keep `_ORIENTATION_MAP`. The `import threading` line may be removed if unused elsewhere (it is — remove it).

- [ ] **Step 2: Edit `__init__` — the `# ---- vision / tracking ----` block**

Replace the whole vision block (from the `self._lock = threading.Lock()` line through the `self._loop = (...)` assignment) with:

```python
        # ---- vision (on-demand capture) ----
        self._tracker = tracker
        self._vision_status = "idle"
        self._detected_orientation: Optional[str] = None
        self._low_confidence: list[str] = []
        self._region: Optional[object] = None  # vision.types.Region | None
```

- [ ] **Step 3: Replace `handle`'s vision branch**

In `handle`, replace the existing vision branch (the `if ctype == "set_auto"` / `capture_now` / `_PAUSE_ON_TRACKING` block plus the `with self._lock:`) so the method reads:

```python
    def handle(self, cmd: dict) -> None:
        ctype = cmd.get("type")
        # Vision commands are on-demand and synchronous; no lock, no thread.
        if ctype == "capture_now":
            self._capture_now()
            return
        if ctype == "request_region_shot":
            self._request_region_shot()
            return
        if ctype == "set_region":
            self._set_region(cmd)
            return
        if ctype == "clear_region":
            self._clear_region()
            return
        try:
            if ctype == "set_fen":
                self.set_fen(cmd["fen"])
            elif ctype == "set_turn":
                self.set_turn(bool(cmd["white"]))
            elif ctype == "make_move":
                self.make_move(cmd["uci"])
            elif ctype == "undo":
                self.undo()
            elif ctype == "play_best":
                self.play_best(cmd["uci"])
            elif ctype == "set_engine":
                self.set_engine(cmd["id"])
            elif ctype == "set_options":
                self.set_options(cmd)
            elif ctype == "stop":
                self.stop_analysis()
            else:
                self._error(f"unknown command: {ctype!r}")
        except (KeyError, ValueError) as exc:
            self._error(str(exc))
```

(`set_fen`/`make_move`/`undo` no longer need the pause gate — there is no Auto to pause.)

- [ ] **Step 4: Replace the `# ---- vision / tracking ----` method block**

Replace `_ensure_loop`, `_set_auto`, `_capture_now`, and `_on_tracked` with:

```python
    # ---- vision (on-demand) ----
    def _ensure_tracker(self) -> None:
        if self._tracker is None:
            from chessmenthol.vision.tracker import Tracker

            self._tracker = Tracker()

    def _capture_now(self) -> None:
        self._ensure_tracker()
        try:
            assembled = self._tracker.detect_position()
        except Exception as exc:  # noqa: BLE001 - capture/detect can fail at runtime
            self._vision_status = "no_board"
            self._error(f"capture failed: {exc}")
            return
        self._apply_detection(assembled)

    def _request_region_shot(self) -> None:
        self._ensure_tracker()
        try:
            image = self._tracker.grab_full_desktop()
        except Exception as exc:  # noqa: BLE001
            self._error(f"screen capture unavailable: {exc}")
            return
        self._send(serialize.region_shot_to_dict(image))

    def _set_region(self, cmd: dict) -> None:
        from chessmenthol.vision.types import Region

        try:
            region = Region(int(cmd["left"]), int(cmd["top"]),
                            int(cmd["width"]), int(cmd["height"]))
        except (KeyError, ValueError, TypeError) as exc:
            self._error(f"invalid region: {exc}")
            return
        if region.width <= 0 or region.height <= 0 or region.left < 0 or region.top < 0:
            self._error("invalid region: must be positive and on-screen")
            return
        self._ensure_tracker()
        self._tracker.set_region(region)
        self._region = region
        self._capture_now()

    def _clear_region(self) -> None:
        self._region = None
        if self._tracker is not None:
            self._tracker.set_region(None)
        self._send(self._state_frame(self._last_analysis, self._board))

    def _apply_detection(self, assembled) -> None:
        if assembled is None or not assembled.is_legal:
            self._vision_status = "no_board"
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        self._detected_orientation = _ORIENTATION_MAP.get(assembled.orientation)
        self._low_confidence = list(assembled.low_confidence)
        self._vision_status = "low_confidence" if assembled.low_confidence else "found"
        # Compare PLACEMENT only (a screenshot can't read turn/castling/ep reliably).
        if assembled.fen.split()[0] != self._board.board_fen():
            self._apply_fen(assembled.fen)
        else:
            self._send(self._state_frame(self._last_analysis, self._board))
```

- [ ] **Step 5: Update `close` and `_state_frame`**

In `close`, **remove** the `if self._loop is not None: self._loop.stop()` block (keep the session/engine close).

In `_state_frame`, replace the `"tracking"`/`"visionStatus"` tail with:
```python
            "lastMove": self._last_move,
            "visionStatus": self._vision_status,
            "detectedOrientation": self._detected_orientation,
            "lowConfidence": self._low_confidence,
            "region": (
                {"left": self._region.left, "top": self._region.top,
                 "width": self._region.width, "height": self._region.height}
                if self._region is not None else None
            ),
        }
```
(Drop the `"tracking": self._tracking,` line entirely.)

- [ ] **Step 6: Run the server suite to see what breaks**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py -q`
Expected: FAIL — the old vision tests reference `set_auto`, `_tracking`, and `"tracking"`/`"searching"`.

- [ ] **Step 7: Rewrite the vision section of `tests/server/test_orchestrator.py`**

Replace the `FakeTracker` class and everything from `def test_capture_now_legal_detection_drives_set_fen` down to (but not including) `class RecordingEngine:` with:

```python
class FakeTracker:
    def __init__(self, result):
        self.result = result
        self.side_override = None
        self.region = "unset"
        self.full = np.zeros((6, 8, 3), np.uint8)

    def detect_position(self, frame=None):
        return self.result

    def grab_full_desktop(self):
        return self.full

    def set_region(self, region):
        self.region = region

    def set_side_override(self, side):
        self.side_override = side

    def set_orientation_override(self, o):
        pass

    def reset(self):
        pass


def _legal_assembled(fen):
    board = chess.Board(fen)
    grid = [[SquareLabel(None, 1.0) for _ in range(8)] for _ in range(8)]
    for sq in chess.SQUARES:
        p = board.piece_at(sq)
        if p:
            grid[7 - chess.square_rank(sq)][chess.square_file(sq)] = SquareLabel(p, 1.0)
    return assemble(grid, orientation="white_bottom", side_to_move=board.turn)


def test_capture_now_legal_detection_drives_set_fen(make_orchestrator):
    target = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(_legal_assembled(target)), send=frames.append)
    orch.handle({"type": "capture_now"})
    assert orch._board.board_fen() == chess.Board(target).board_fen()
    assert frames and frames[-1]["visionStatus"] in ("found", "low_confidence")


def test_illegal_detection_reports_no_board(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    before = orch._board.fen()
    orch.handle({"type": "capture_now"})
    assert orch._board.fen() == before
    assert frames[-1]["visionStatus"] == "no_board"


def test_set_turn_sets_tracker_side_override(make_orchestrator):
    tracker = FakeTracker(None)
    orch = make_orchestrator(tracker=tracker, send=lambda f: None)
    orch.handle({"type": "set_turn", "white": False})
    assert tracker.side_override == chess.BLACK


def test_request_region_shot_emits_region_shot_frame(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    orch.handle({"type": "request_region_shot"})
    shot = [f for f in frames if f["type"] == "region_shot"][-1]
    assert shot["width"] == 8 and shot["height"] == 6
    assert isinstance(shot["jpegBase64"], str) and shot["jpegBase64"]


def test_set_region_stores_and_captures(make_orchestrator):
    target = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    frames = []
    tracker = FakeTracker(_legal_assembled(target))
    orch = make_orchestrator(tracker=tracker, send=frames.append)
    orch.handle({"type": "set_region", "left": 5, "top": 6, "width": 100, "height": 120})
    assert tracker.region.left == 5 and tracker.region.width == 100
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["region"] == {"left": 5, "top": 6, "width": 100, "height": 120}
    assert orch._board.board_fen() == chess.Board(target).board_fen()  # captured


def test_set_region_rejects_bad_rectangle(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    orch.handle({"type": "set_region", "left": 0, "top": 0, "width": 0, "height": 10})
    assert frames[-1]["type"] == "error"


def test_clear_region_resets(make_orchestrator):
    frames = []
    tracker = FakeTracker(None)
    orch = make_orchestrator(tracker=tracker, send=frames.append)
    orch.handle({"type": "set_region", "left": 1, "top": 1, "width": 10, "height": 10})
    orch.handle({"type": "clear_region"})
    assert tracker.region is None
    assert frames[-1]["region"] is None
```

Ensure `import numpy as np` is present at the top of the test file (add it if missing).

- [ ] **Step 8: Run the server suite to verify pass**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py -q`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add chessmenthol/server/orchestrator.py tests/server/test_orchestrator.py
git commit -m "feat(server): on-demand region/capture commands; remove auto-tracking + lock"
```

---

### Task 6: Frontend pure coordinate mapping (`lib/region.ts`)

**Files:**
- Create: `frontend/src/lib/region.ts`
- Test: `frontend/src/tests/region.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/tests/region.test.ts
import { describe, it, expect } from 'vitest';
import { toDesktopRegion } from '../lib/region';

const displayed = { width: 1000, height: 500 };
const real = { width: 2000, height: 1000 };

describe('toDesktopRegion', () => {
  it('scales a forward drag to true desktop pixels', () => {
    const r = toDesktopRegion({ x: 100, y: 50, w: 200, h: 100 }, displayed, real);
    expect(r).toEqual({ left: 200, top: 100, width: 400, height: 200 });
  });

  it('normalizes a reversed (up-left) drag', () => {
    const r = toDesktopRegion({ x: 300, y: 150, w: -200, h: -100 }, displayed, real);
    expect(r).toEqual({ left: 200, top: 100, width: 400, height: 200 });
  });

  it('clamps a drag that runs off the edge', () => {
    const r = toDesktopRegion({ x: 900, y: 450, w: 400, h: 400 }, displayed, real);
    expect(r).toEqual({ left: 1800, top: 900, width: 200, height: 100 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/region.test.ts`
Expected: FAIL — cannot resolve `../lib/region`.

- [ ] **Step 3: Implement `frontend/src/lib/region.ts`**

```typescript
export interface Region { left: number; top: number; width: number; height: number; }
export interface Box { x: number; y: number; w: number; h: number; }
export interface Size { width: number; height: number; }

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/** Map a drag box (in displayed-image pixels, w/h may be negative) to a region in
 *  true desktop pixels. Normalizes reversed drags and clamps to the image bounds. */
export function toDesktopRegion(box: Box, displayed: Size, real: Size): Region {
  const x0 = clamp(Math.min(box.x, box.x + box.w), 0, displayed.width);
  const y0 = clamp(Math.min(box.y, box.y + box.h), 0, displayed.height);
  const x1 = clamp(Math.max(box.x, box.x + box.w), 0, displayed.width);
  const y1 = clamp(Math.max(box.y, box.y + box.h), 0, displayed.height);
  const kx = real.width / displayed.width;
  const ky = real.height / displayed.height;
  return {
    left: Math.round(x0 * kx),
    top: Math.round(y0 * ky),
    width: Math.round((x1 - x0) * kx),
    height: Math.round((y1 - y0) * ky),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/tests/region.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/region.ts frontend/src/tests/region.test.ts
git commit -m "feat(frontend): pure toDesktopRegion coordinate mapping"
```

---

### Task 7: Frontend types + ws store

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/ws.ts`
- Test: `frontend/src/tests/ws.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/tests/ws.test.ts`:

```typescript
import { get } from 'svelte/store';
import { regionShot, applyFrame } from '../lib/ws';

it('routes a region_shot frame to the regionShot store', () => {
  applyFrame({ type: 'region_shot', jpegBase64: 'AAAA', width: 5120, height: 1440 });
  expect(get(regionShot)).toEqual({ type: 'region_shot', jpegBase64: 'AAAA', width: 5120, height: 1440 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/ws.test.ts`
Expected: FAIL — `regionShot` is not exported.

- [ ] **Step 3: Edit `frontend/src/lib/types.ts`**

Replace the `StateFrame` interface, add `RegionShotFrame`, widen `ServerFrame`, and update `Command`:

```typescript
export interface StateFrame {
  type: 'state'; fen: string; sideToMove: 'white' | 'black'; engineId: string;
  analyzing: boolean; eval: EvalDto | null; depth: number; lines: LineDto[];
  lastMove: LastMoveDto | null;
  visionStatus: 'idle' | 'found' | 'no_board' | 'low_confidence';
  detectedOrientation: 'white' | 'black' | null; lowConfidence: string[];
  region: { left: number; top: number; width: number; height: number } | null;
}
export interface RegionShotFrame { type: 'region_shot'; jpegBase64: string; width: number; height: number; }
export interface ErrorFrame { type: 'error'; message: string; }
export type ServerFrame = StateFrame | ErrorFrame | RegionShotFrame;

export type Command =
  | { type: 'set_fen'; fen: string }
  | { type: 'set_turn'; white: boolean }
  | { type: 'make_move'; uci: string }
  | { type: 'undo' }
  | { type: 'set_engine'; id: string }
  | { type: 'set_options'; depth?: number; multipv?: number; threads?: number; hash?: number }
  | { type: 'stop' }
  | { type: 'capture_now' }
  | { type: 'request_region_shot' }
  | { type: 'set_region'; left: number; top: number; width: number; height: number }
  | { type: 'clear_region' }
  | { type: 'play_best'; uci: string };
```

(Remove the old `{ type: 'set_auto'; on: boolean }` line and the old `tracking`/`visionStatus` fields.)

- [ ] **Step 4: Edit `frontend/src/lib/ws.ts`**

Add the store and route the frame. After the existing `export const errorSeq` line add:
```typescript
import type { RegionShotFrame } from './types';
export const regionShot = writable<RegionShotFrame | null>(null);
```
And in `applyFrame`, extend the branches:
```typescript
export function applyFrame(frame: ServerFrame): void {
  if (frame.type === 'state') state.set(frame);
  else if (frame.type === 'region_shot') regionShot.set(frame);
  else if (frame.type === 'error') {
    lastError.set(frame.message);
    errorSeq.update((n) => n + 1);
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd frontend && npx vitest run src/tests/ws.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/ws.ts frontend/src/tests/ws.test.ts
git commit -m "feat(frontend): region_shot frame type + regionShot store; on-demand command types"
```

---

### Task 8: Controls — Region / Capture / Clear source controls

**Files:**
- Modify: `frontend/src/components/Controls.svelte`
- Test: `frontend/src/tests/Controls.test.ts`

- [ ] **Step 1: Update the Controls tests**

In `frontend/src/tests/Controls.test.ts`:
- **Delete** the test `'region-btn remains disabled'`.
- **Delete** the test `'Auto button is enabled and emits set_auto'`.
- **Keep** `'Capture button emits capture_now'`.
- **Add** these tests:

```typescript
it('Region button calls onPickRegion', async () => {
  const onPickRegion = vi.fn();
  const { getByTestId } = render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish',
    analyzing: true, fen: 'startpos', onCommand: vi.fn(), onPickRegion } as any });
  await fireEvent.click(getByTestId('region-btn'));
  expect(onPickRegion).toHaveBeenCalled();
});

it('Clear button appears with a region and emits clear_region', async () => {
  const onCommand = vi.fn();
  const { getByTestId } = render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish',
    analyzing: true, fen: 'startpos', onCommand,
    region: { left: 1, top: 1, width: 10, height: 10 } } as any });
  await fireEvent.click(getByTestId('clear-region-btn'));
  expect(onCommand).toHaveBeenCalledWith({ type: 'clear_region' });
});

it('hides Clear when no region is set', () => {
  const { queryByTestId } = render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish',
    analyzing: true, fen: 'startpos', onCommand: vi.fn(), region: null } as any });
  expect(queryByTestId('clear-region-btn')).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/Controls.test.ts`
Expected: FAIL — `region-btn` is disabled / `onPickRegion` not wired / no `clear-region-btn`.

- [ ] **Step 3: Edit `frontend/src/components/Controls.svelte`**

In the `<script>` props, **remove** `export let tracking` and **add**:
```typescript
  export let region: { left: number; top: number; width: number; height: number } | null = null;
  export let onPickRegion: () => void = () => {};
```

Replace the **Source** `<section>` markup with:
```svelte
  <section class="csec">
    <div class="clab">◉ Source</div>
    <div class="btns">
      <button data-testid="region-btn" on:click={onPickRegion}>Region</button>
      <button data-testid="capture-btn"
        on:click={() => onCommand({ type: 'capture_now' })}>Capture</button>
      {#if region}
        <button data-testid="clear-region-btn"
          on:click={() => onCommand({ type: 'clear_region' })}>Clear</button>
      {/if}
    </div>
    <span class="vision-status" data-testid="vision-status">
      {#if visionStatus === 'found'}found ●
      {:else if visionStatus === 'low_confidence'}● {lowConfidence.length} uncertain
      {:else if visionStatus === 'no_board'}no board
      {:else}—{/if}
    </span>
  </section>
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/tests/Controls.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Controls.svelte frontend/src/tests/Controls.test.ts
git commit -m "feat(frontend): Region/Capture/Clear source controls; drop Auto button"
```

---

### Task 9: RegionOverlay component

**Files:**
- Create: `frontend/src/components/RegionOverlay.svelte`
- Test: `frontend/src/tests/RegionOverlay.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/tests/RegionOverlay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RegionOverlay from '../components/RegionOverlay.svelte';

const shot = { type: 'region_shot' as const, jpegBase64: 'AAAA', width: 1000, height: 500 };

describe('RegionOverlay', () => {
  it('shows a capturing state until a shot arrives', () => {
    render(RegionOverlay, { props: { shot: null, onConfirm: vi.fn(), onCancel: vi.fn() } as any });
    expect(screen.getByTestId('overlay-capturing')).toBeTruthy();
  });

  it('renders the screenshot when a shot is present', () => {
    render(RegionOverlay, { props: { shot, onConfirm: vi.fn(), onCancel: vi.fn() } as any });
    const img = screen.getByTestId('overlay-img') as HTMLImageElement;
    expect(img.src).toContain('data:image/jpeg;base64,AAAA');
  });

  it('Cancel calls onCancel', async () => {
    const onCancel = vi.fn();
    render(RegionOverlay, { props: { shot, onConfirm: vi.fn(), onCancel } as any });
    await fireEvent.click(screen.getByTestId('overlay-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('a drag + Use emits a true-pixel region via onConfirm', async () => {
    const onConfirm = vi.fn();
    render(RegionOverlay, { props: { shot, onConfirm, onCancel: vi.fn() } as any });
    const img = screen.getByTestId('overlay-img') as HTMLImageElement;
    // Make the image report a 500x250 display rect (half the 1000x500 true size).
    img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 250,
      right: 500, bottom: 250, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    Object.defineProperty(img, 'clientWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'clientHeight', { value: 250, configurable: true });
    await fireEvent.mouseDown(img, { clientX: 50, clientY: 25 });
    await fireEvent.mouseMove(window, { clientX: 150, clientY: 75 });
    await fireEvent.mouseUp(window, { clientX: 150, clientY: 75 });
    await fireEvent.click(screen.getByTestId('overlay-use'));
    // 50..150 displayed *2 -> 100..300 true; 25..75 *2 -> 50..150 true.
    expect(onConfirm).toHaveBeenCalledWith({ left: 100, top: 50, width: 200, height: 100 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/RegionOverlay.test.ts`
Expected: FAIL — cannot resolve `../components/RegionOverlay.svelte`.

- [ ] **Step 3: Implement `frontend/src/components/RegionOverlay.svelte`**

```svelte
<script lang="ts">
  import type { RegionShotFrame } from '../lib/types';
  import { toDesktopRegion, type Region } from '../lib/region';
  export let shot: RegionShotFrame | null = null;
  export let onConfirm: (r: Region) => void = () => {};
  export let onCancel: () => void = () => {};

  let img: HTMLImageElement;
  let dragging = false;
  let sx = 0, sy = 0;            // start, in image-displayed px
  let box = { x: 0, y: 0, w: 0, h: 0 };
  let hasBox = false;

  function localXY(e: MouseEvent) {
    const r = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - r.left, r.width)),
      y: Math.max(0, Math.min(e.clientY - r.top, r.height)),
    };
  }
  function onDown(e: MouseEvent) {
    const p = localXY(e); sx = p.x; sy = p.y;
    box = { x: sx, y: sy, w: 0, h: 0 }; dragging = true; hasBox = true;
  }
  function onMove(e: MouseEvent) {
    if (!dragging) return;
    const p = localXY(e); box = { x: sx, y: sy, w: p.x - sx, h: p.y - sy };
  }
  function onUp() { dragging = false; }
  function use() {
    if (!shot || !hasBox) { onCancel(); return; }
    const region = toDesktopRegion(
      box,
      { width: img.clientWidth, height: img.clientHeight },
      { width: shot.width, height: shot.height },
    );
    onConfirm(region);
  }
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }

  // Normalized selection rectangle in displayed px for the visual highlight.
  $: selL = Math.min(box.x, box.x + box.w);
  $: selT = Math.min(box.y, box.y + box.h);
  $: selW = Math.abs(box.w);
  $: selH = Math.abs(box.h);
</script>

<svelte:window on:mousemove={onMove} on:mouseup={onUp} on:keydown={onKey} />

<div class="overlay" data-testid="region-overlay">
  <div class="bar">
    <span>◉ Drag a box over the chess board</span>
    <button data-testid="overlay-use" on:click={use}>Use region</button>
    <button data-testid="overlay-cancel" class="ghost" on:click={onCancel}>Cancel</button>
  </div>
  {#if shot}
    <div class="stage">
      <img data-testid="overlay-img" bind:this={img} alt="screen"
        src={`data:image/jpeg;base64,${shot.jpegBase64}`} on:mousedown|preventDefault={onDown} />
      {#if hasBox}
        <div class="sel" style={`left:${selL}px;top:${selT}px;width:${selW}px;height:${selH}px`}></div>
      {/if}
    </div>
  {:else}
    <div class="capturing" data-testid="overlay-capturing">capturing…</div>
  {/if}
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 50; background: #0b0c0f;
    display: flex; flex-direction: column; align-items: center; }
  .bar { display: flex; gap: 10px; align-items: center; padding: 8px 12px; color: #e8e8e8;
    font: 12px system-ui; width: 100%; box-sizing: border-box; background: #1b1e24; }
  .bar button { margin-left: auto; font: 12px system-ui; padding: 5px 12px; border-radius: 6px;
    cursor: pointer; background: #11a26b; border: 1px solid #11a26b; color: #04150e; font-weight: 600; }
  .bar button.ghost { margin-left: 0; background: #23262d; border-color: #3a3d44; color: #e8e8e8; }
  .stage { position: relative; flex: 1; display: flex; min-height: 0; cursor: crosshair; }
  img { max-width: 100vw; max-height: calc(100vh - 40px); object-fit: contain; user-select: none; }
  .sel { position: absolute; border: 2px solid #11a26b; background: rgba(17,162,107,0.18);
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.55); pointer-events: none; }
  .capturing { color: #aaa; font: 13px system-ui; margin: auto; }
</style>
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/tests/RegionOverlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RegionOverlay.svelte frontend/src/tests/RegionOverlay.test.ts
git commit -m "feat(frontend): RegionOverlay fullscreen drag-select component"
```

---

### Task 10: App wiring

**Files:**
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Edit the `<script>` of `frontend/src/App.svelte`**

Add to the imports:
```typescript
  import { state, lastError, connected, errorSeq, regionShot, connect, send } from './lib/ws';
  import RegionOverlay from './components/RegionOverlay.svelte';
  import type { Region } from './lib/region';
```
(Replace the existing `import { state, ... } from './lib/ws';` line with the one above — it adds `regionShot`.)

Add state and handlers:
```typescript
  let pickingRegion = false;
  function onPickRegion() { regionShot.set(null); pickingRegion = true; send({ type: 'request_region_shot' }); }
  function onConfirmRegion(r: Region) { pickingRegion = false; send({ type: 'set_region', ...r }); }
  function onCancelRegion() { pickingRegion = false; }
```

In `onToggleEdit`, **remove** the `send({ type: 'set_auto', on: false });` line (there is no Auto to pause) — leave the rest of the function unchanged.

Change the orientation-follow reactive block from:
```typescript
  $: if (s?.tracking && s?.detectedOrientation && !manualFlip) {
    orientation = s.detectedOrientation as 'white' | 'black';
  }
```
to:
```typescript
  $: if (s?.detectedOrientation && !manualFlip) {
    orientation = s.detectedOrientation as 'white' | 'black';
  }
```

In `onCommand`, the `if (cmd.type === 'set_auto' && cmd.on) manualFlip = false;` line references a removed command — **replace** it with a reset on region pick instead by deleting that line (manualFlip is reset by Flip only now).

- [ ] **Step 2: Edit the markup of `frontend/src/App.svelte`**

In the `<Controls .../>` element, **remove** `tracking={s?.tracking ?? false}` and **add**:
```svelte
          region={s?.region ?? null}
          onPickRegion={onPickRegion}
```

At the end of `<main>` (just before `</main>`), add:
```svelte
  {#if pickingRegion}
    <RegionOverlay shot={$regionShot} onConfirm={onConfirmRegion} onCancel={onCancelRegion} />
  {/if}
```

- [ ] **Step 3: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS (all suites, including the existing `smoke.test.ts`). If `smoke.test.ts` or another test references `tracking`/`set_auto`, update it to the new props/commands.

- [ ] **Step 4: Type-check the build**

Run: `cd frontend && npm run build`
Expected: builds with no TypeScript errors into `chessmenthol/server/static/`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.svelte
git commit -m "feat(frontend): wire RegionOverlay + on-demand region commands; drop auto-follow"
```

---

### Task 11: Full verification + manual live check

**Files:** none (verification only)

- [ ] **Step 1: Run the whole Python suite**

Run: `.venv/bin/pytest -q`
Expected: PASS (engine tests auto-skip without bundled Stockfish). No references to `TrackingLoop`/`set_auto` remain.

- [ ] **Step 2: Run the whole frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 3: Grep for dangling removed symbols**

Run: `grep -rn "set_auto\|TrackingLoop\|grab_if_changed\|\.tracking\b\|_PAUSE_ON_TRACKING" chessmenthol frontend/src tests`
Expected: no hits in source (matches only in the spec/plan docs are fine).

- [ ] **Step 4: Manual live check (on the dev's KDE/Wayland machine)**

Run: `.venv/bin/chessmenthol-server` then open http://127.0.0.1:8765/.
Verify: click **Region** → a fullscreen screenshot of the desktop appears → drag a box over a chess board (e.g. a lichess board in a browser window) → **Use region** → the board is detected, analysis starts, the eval/arrows update. Click **Capture** again after moving a piece on screen → the position updates. Click **Clear** → region resets to the whole desktop. (Wayland is the hardest target; `mss` platforms are strictly easier.)

- [ ] **Step 5: Update the milestone memory**

Update `milestone-roadmap.md`: mark **M5b DONE** with the branch/HEAD and the key decisions (custom fullscreen overlay; on-demand only; continuous tracking removed; WaylandShotBackend via screenshot CLI; no new dep), and note **M5c (packaging) is next**.

- [ ] **Step 6: Finalize the branch**

Use the `superpowers:finishing-a-development-branch` skill to merge `feat/milestone-5b-region-select` into `main` (fast-forward, per the milestone convention).

---

## Self-Review

**Spec coverage:**
- §4.1 grab_full + Capturer crop → Task 1. §4.2 WaylandShotBackend (CLI) → Task 1 + spike Task 0. §4.3 backend selection → Task 1. §4.4 removals (TrackingLoop, grab_if_changed, set_auto, lock, _PAUSE_ON_TRACKING) → Tasks 2, 3, 5. §5.1 commands (request_region_shot/set_region/clear_region/capture_now) → Task 5. §5.2 region_shot frame → Tasks 4, 5, 7. §5.3 state-frame changes (drop tracking, add region, new visionStatus) → Task 5. §6.1 RegionOverlay → Task 9. §6.2 lib/region.ts → Task 6. §6.3 Controls → Task 8. §6.4 App wiring → Task 10. §6.5 types/ws → Task 7. §8 error handling → covered by Task 5 (`no_board`, capture-unavailable error, bad-region reject) and Task 9 (capturing state / cancel). §9 tests → each task is TDD. §10 no new dep → no pyproject task needed. §11 out-of-scope items are not built. **No gaps.**
- **Lock removal safety** (flagged in the spec): Task 5 removes `self._lock`; the analysis worker's `_on_update` was never under that lock (only the deleted tracking thread was), so synchronous command-path capture introduces no new shared-state race. Verified by the green server suite in Task 5/11.

**Placeholder scan:** every code step contains complete, runnable code; no TBD/TODO/"similar to". The one manual step (Task 11 live check) is verification, not code.

**Type consistency:** `grab_full()` (backend) / `grab()` + `grab_full_desktop()` (Capturer) used consistently across Tasks 1–2 and the orchestrator (Task 5). `region_shot_to_dict` signature matches its caller in Task 5 and the frame shape in Tasks 4/7/9. `toDesktopRegion(box, displayed, real)` signature matches its caller in RegionOverlay (Task 9). `visionStatus` values (`idle`/`found`/`no_board`/`low_confidence`) match across orchestrator (Task 5), types (Task 7), and Controls (Task 8). Command names match between `types.ts` (Task 7), Controls/App (Tasks 8/10), and the orchestrator handler (Task 5).
