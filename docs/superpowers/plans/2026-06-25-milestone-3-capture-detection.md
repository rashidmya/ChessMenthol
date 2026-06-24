# Milestone 3 — Screen Capture + Board Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `capture` and `board_detect` computer-vision modules plus a `chessmenthol-detect` debug CLI that locates an axis-aligned chessboard in a screenshot and slices it into 64 squares.

**Architecture:** A new `chessmenthol/vision/` package. `capture.py` grabs BGR frames from a monitor/region behind a swappable backend. `detect.py` finds the board by recovering the grid's periodicity (square pitch + phase) from edge projections and validating a two-color checker pattern — no perspective handling, since online boards render axis-aligned. `overlay.py` + `cli.py` give a developer a visual/text check. No `server/` or `frontend/` changes (that integration is Milestone 4).

**Tech Stack:** Python 3.11+, `numpy`, `opencv-python-headless`, `mss`, `pytest`.

**Reference spec:** `docs/superpowers/specs/2026-06-25-milestone-3-capture-detection-design.md`

**Conventions:** Every Python file starts with `from __future__ import annotations`. Images are BGR `uint8` ndarrays. Run tests with `.venv/bin/pytest`; install with `.venv/bin/pip`.

---

## File Structure

| File | Responsibility |
|---|---|
| `chessmenthol/vision/__init__.py` | Package marker |
| `chessmenthol/vision/types.py` | `Region`, `Monitor`, `Frame`, `BoardLocation`, `SquareImage` dataclasses |
| `chessmenthol/vision/capture.py` | `CaptureBackend` Protocol, `MssBackend`, `Capturer` |
| `chessmenthol/vision/detect.py` | `detect()`, `crop_squares()`, `square_name()` + private helpers |
| `chessmenthol/vision/overlay.py` | `render_overlay()` debug drawing |
| `chessmenthol/vision/cli.py` | `main()` for `chessmenthol-detect` |
| `tests/vision/synthetic.py` | Deterministic board renderer returning image + ground-truth `BoardLocation` |
| `tests/vision/fakes.py` | `FakeBackend` for capture/CLI tests |
| `tests/vision/fixtures/` | Real screenshots + `ground_truth.json` |
| `tests/vision/test_*.py` | One test module per source module |

---

## Task 1: Dependencies + package scaffold

**Files:**
- Modify: `pyproject.toml`
- Create: `chessmenthol/vision/__init__.py`
- Create: `tests/vision/__init__.py`

- [ ] **Step 1: Add runtime dependencies**

In `pyproject.toml`, change the `dependencies` line to:

```toml
dependencies = [
    "chess>=1.11",
    "fastapi>=0.110",
    "uvicorn[standard]>=0.29",
    "mss>=9",
    "opencv-python-headless>=4.9",
    "numpy>=1.26",
]
```

- [ ] **Step 2: Create the package files**

Create `chessmenthol/vision/__init__.py`:

```python
"""Screen capture and geometric chessboard detection (Milestone 3)."""
```

Create empty `tests/vision/__init__.py` (zero bytes).

- [ ] **Step 3: Install and verify imports**

Run: `.venv/bin/pip install -e '.[dev]'`
Then run: `.venv/bin/python -c "import cv2, mss, numpy, chessmenthol.vision; print('ok')"`
Expected: prints `ok` (mss import may emit no error even headless; we never call it here).

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml chessmenthol/vision/__init__.py tests/vision/__init__.py
git commit -m "chore(vision): add capture/detection deps and package scaffold"
```

---

## Task 2: Core types

**Files:**
- Create: `chessmenthol/vision/types.py`
- Test: `tests/vision/test_types.py`

- [ ] **Step 1: Write the failing test**

Create `tests/vision/test_types.py`:

```python
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
    # col=0,row=0 is the top-left cell
    assert loc.cell_rect(0, 0) == Region(0, 0, 10, 10)
    # col=7,row=7 is the bottom-right cell
    assert loc.cell_rect(7, 7) == Region(70, 70, 10, 10)


def test_square_image_holds_name_and_array():
    s = SquareImage(square="e4", image=np.zeros((8, 8, 3), dtype=np.uint8))
    assert s.square == "e4"
    assert s.image.shape == (8, 8, 3)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/vision/test_types.py -v`
Expected: FAIL — `ModuleNotFoundError: chessmenthol.vision.types`.

- [ ] **Step 3: Write the implementation**

Create `chessmenthol/vision/types.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

import numpy as np

Orientation = Literal["white_bottom", "black_bottom"]


@dataclass(frozen=True)
class Region:
    left: int
    top: int
    width: int
    height: int


@dataclass(frozen=True)
class Monitor:
    index: int
    left: int
    top: int
    width: int
    height: int


@dataclass
class Frame:
    """A captured image. `image` is BGR uint8 (H, W, 3); `origin` is the
    screen-space coordinate of the frame's top-left pixel."""

    image: np.ndarray
    origin: tuple[int, int] = (0, 0)


@dataclass(frozen=True)
class BoardLocation:
    bbox: Region
    grid_x: list[int]  # 9 vertical grid-line x-positions (left -> right)
    grid_y: list[int]  # 9 horizontal grid-line y-positions (top -> bottom)
    square_size: float
    orientation_hint: Optional[Orientation]
    highlight_squares: list[str] = field(default_factory=list)
    confidence: float = 0.0

    def cell_rect(self, col: int, row: int) -> Region:
        """Geometric cell rectangle; (col=0, row=0) is the board's top-left."""
        x0, x1 = self.grid_x[col], self.grid_x[col + 1]
        y0, y1 = self.grid_y[row], self.grid_y[row + 1]
        return Region(left=x0, top=y0, width=x1 - x0, height=y1 - y0)


@dataclass
class SquareImage:
    square: str  # provisional algebraic name, e.g. "e4"
    image: np.ndarray
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/vision/test_types.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/vision/types.py tests/vision/test_types.py
git commit -m "feat(vision): add core capture/detection dataclasses"
```

---

## Task 3: Synthetic board renderer (test helper)

**Files:**
- Create: `tests/vision/synthetic.py`
- Test: `tests/vision/test_synthetic.py`

This helper renders a deterministic board and returns the exact ground-truth `BoardLocation`, so detection tests can assert against known geometry. It is dev-only (lives under `tests/`).

- [ ] **Step 1: Write the failing test**

Create `tests/vision/test_synthetic.py`:

```python
from __future__ import annotations

import numpy as np

from tests.vision.synthetic import render_board


def test_render_board_geometry_matches_ground_truth():
    img, truth = render_board(square=32, margin=16)
    assert img.shape == (32 * 8 + 32, 32 * 8 + 32, 3)  # margin on both sides
    assert img.dtype == np.uint8
    assert truth.bbox.left == 16 and truth.bbox.top == 16
    assert truth.bbox.width == 256 and truth.bbox.height == 256
    assert truth.grid_x == [16, 48, 80, 112, 144, 176, 208, 240, 272]
    assert truth.square_size == 32.0


def test_render_board_cells_alternate_colors():
    img, truth = render_board(square=32, margin=16)
    # top-left cell vs its right neighbour differ
    c00 = img[truth.grid_y[0] + 16, truth.grid_x[0] + 16]
    c01 = img[truth.grid_y[0] + 16, truth.grid_x[1] + 16]
    assert not np.array_equal(c00, c01)


def test_render_board_orientation_hint_white_bottom():
    # default light/dark such that bottom-left (col0,row7) is dark
    _, truth = render_board(square=32, margin=16)
    assert truth.orientation_hint == "white_bottom"


def test_render_board_highlights_recorded():
    _, truth = render_board(square=32, margin=16, highlights=["e2", "e4"])
    assert set(truth.highlight_squares) == {"e2", "e4"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/vision/test_synthetic.py -v`
Expected: FAIL — `ModuleNotFoundError: tests.vision.synthetic`.

- [ ] **Step 3: Write the implementation**

Create `tests/vision/synthetic.py`:

```python
from __future__ import annotations

import numpy as np

from chessmenthol.vision.types import BoardLocation, Region

# BGR colors
_LIGHT = (181, 217, 240)   # light square
_DARK = (99, 136, 181)     # dark square
_BG = (60, 60, 60)         # page background
_HIGHLIGHT = (90, 200, 230)  # tinted highlight overlay color (BGR)


def _square_to_colrow(square: str) -> tuple[int, int]:
    """Algebraic -> geometric (col, row) under white_bottom."""
    col = ord(square[0]) - ord("a")
    row = 8 - int(square[1])
    return col, row


def render_board(
    *,
    square: int = 32,
    margin: int = 16,
    light: tuple[int, int, int] = _LIGHT,
    dark: tuple[int, int, int] = _DARK,
    bg: tuple[int, int, int] = _BG,
    pieces: list[str] | None = None,
    highlights: list[str] | None = None,
) -> tuple[np.ndarray, BoardLocation]:
    """Render an axis-aligned board. Returns (BGR image, ground-truth location).

    Deterministic — all variation comes from explicit parameters. `pieces` and
    `highlights` are algebraic square names under the white_bottom convention.
    """
    board_px = square * 8
    canvas = margin * 2 + board_px
    img = np.empty((canvas, canvas, 3), dtype=np.uint8)
    img[:, :] = bg

    for row in range(8):
        for col in range(8):
            x0 = margin + col * square
            y0 = margin + row * square
            # (col+row) even -> light at top-left so bottom-left (row7,col0) is dark
            color = light if (col + row) % 2 == 0 else dark
            img[y0 : y0 + square, x0 : x0 + square] = color

    if highlights:
        for sq in highlights:
            col, row = _square_to_colrow(sq)
            x0 = margin + col * square
            y0 = margin + row * square
            cell = img[y0 : y0 + square, x0 : x0 + square].astype(np.float32)
            tint = np.array(_HIGHLIGHT, dtype=np.float32)
            img[y0 : y0 + square, x0 : x0 + square] = (
                0.5 * cell + 0.5 * tint
            ).astype(np.uint8)

    if pieces:
        import cv2

        for sq in pieces:
            col, row = _square_to_colrow(sq)
            cx = margin + col * square + square // 2
            cy = margin + row * square + square // 2
            cv2.circle(img, (cx, cy), square // 3, (20, 20, 20), -1)

    grid_x = [margin + i * square for i in range(9)]
    grid_y = [margin + i * square for i in range(9)]
    truth = BoardLocation(
        bbox=Region(margin, margin, board_px, board_px),
        grid_x=grid_x,
        grid_y=grid_y,
        square_size=float(square),
        orientation_hint="white_bottom",
        highlight_squares=list(highlights or []),
        confidence=1.0,
    )
    return img, truth
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/vision/test_synthetic.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add tests/vision/synthetic.py tests/vision/test_synthetic.py
git commit -m "test(vision): add deterministic synthetic board renderer"
```

---

## Task 4: Capture module

**Files:**
- Create: `chessmenthol/vision/capture.py`
- Create: `tests/vision/fakes.py`
- Test: `tests/vision/test_capture.py`

- [ ] **Step 1: Write the FakeBackend helper**

Create `tests/vision/fakes.py`:

```python
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
```

- [ ] **Step 2: Write the failing test**

Create `tests/vision/test_capture.py`:

```python
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/vision/test_capture.py -v`
Expected: FAIL — `ModuleNotFoundError: chessmenthol.vision.capture`.

- [ ] **Step 4: Write the implementation**

Create `chessmenthol/vision/capture.py`:

```python
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/vision/test_capture.py -v`
Expected: PASS (5 passed).

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/vision/capture.py tests/vision/fakes.py tests/vision/test_capture.py
git commit -m "feat(vision): add Capturer with swappable backend and change-detection"
```

---

## Task 5: Board detection — geometry + checker-validation

**Files:**
- Create: `chessmenthol/vision/detect.py`
- Test: `tests/vision/test_detect.py`

This task delivers `detect()` returning the board bbox, 9×9 grid lines, and a confidence score, plus the `square_name()` helper. Orientation/highlights/crop come in Tasks 6–7.

- [ ] **Step 1: Write the failing test**

Create `tests/vision/test_detect.py`:

```python
from __future__ import annotations

import numpy as np

from chessmenthol.vision.detect import detect, square_name
from chessmenthol.vision.types import Frame
from tests.vision.synthetic import render_board


def _iou(a, b) -> float:
    ax0, ay0, ax1, ay1 = a.left, a.top, a.left + a.width, a.top + a.height
    bx0, by0, bx1, by1 = b.left, b.top, b.left + b.width, b.top + b.height
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    union = a.width * a.height + b.width * b.height - inter
    return inter / union if union else 0.0


def test_detect_clean_board_bbox_iou():
    img, truth = render_board(square=40, margin=24)
    loc = detect(Frame(img))
    assert loc is not None
    assert _iou(loc.bbox, truth.bbox) > 0.95
    assert len(loc.grid_x) == 9 and len(loc.grid_y) == 9
    assert abs(loc.square_size - 40.0) <= 2.0
    assert loc.confidence > 0.6


def test_detect_accepts_plain_ndarray():
    img, _ = render_board(square=32, margin=16)
    assert detect(img) is not None


def test_detect_returns_none_on_noise():
    rng = np.random.default_rng(0)
    noise = rng.integers(0, 255, size=(300, 300, 3), dtype=np.uint8)
    assert detect(noise) is None


def test_square_name_white_bottom():
    # top-left (col0,row0) is a8; bottom-right (col7,row7) is h1
    assert square_name(0, 0, "white_bottom") == "a8"
    assert square_name(7, 7, "white_bottom") == "h1"


def test_square_name_black_bottom():
    assert square_name(0, 0, "black_bottom") == "h1"
    assert square_name(7, 7, "black_bottom") == "a8"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/vision/test_detect.py -v`
Expected: FAIL — `ModuleNotFoundError: chessmenthol.vision.detect`.

- [ ] **Step 3: Write the implementation**

Create `chessmenthol/vision/detect.py`:

```python
from __future__ import annotations

from dataclasses import replace
from typing import Optional, Union

import cv2
import numpy as np

from .types import BoardLocation, Frame, Region, SquareImage

ImageLike = Union[Frame, np.ndarray]
_MIN_SQUARE = 6


def _as_image(frame: ImageLike) -> np.ndarray:
    return frame.image if isinstance(frame, Frame) else frame


def square_name(col: int, row: int, orientation: Optional[str]) -> str:
    """Map geometric (col, row) — (0,0) at board top-left — to algebraic.

    Defaults to the white_bottom convention when orientation is None.
    """
    if orientation == "black_bottom":
        return f"{chr(ord('h') - col)}{row + 1}"
    return f"{chr(ord('a') + col)}{8 - row}"


def _edge_profiles(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
    return gx.sum(axis=0), gy.sum(axis=1)  # (col profile len W, row profile len H)


def _dominant_period(profile: np.ndarray, max_sq: int) -> Optional[int]:
    p = profile.astype(np.float64)
    p = p - p.mean()
    n = len(p)
    ac = np.correlate(p, p, mode="full")[n - 1 :]  # autocorrelation, lags 0..n-1
    lo, hi = _MIN_SQUARE, min(max_sq, n - 1)
    if hi <= lo:
        return None
    return lo + int(np.argmax(ac[lo:hi]))


def _best_phase(profile: np.ndarray, period: int, teeth: int = 9) -> Optional[list[int]]:
    n = len(profile)
    span = period * (teeth - 1)
    if span >= n:
        return None
    teeth_idx = period * np.arange(teeth)
    best_start, best_score = 0, -1.0
    for start in range(0, n - span):
        score = float(profile[start + teeth_idx].sum())
        if score > best_score:
            best_score, best_start = score, start
    return [int(x) for x in (best_start + teeth_idx)]


def _cell_means(image: np.ndarray, grid_x: list[int], grid_y: list[int]) -> np.ndarray:
    means = np.zeros((8, 8, 3), dtype=np.float64)
    for row in range(8):
        for col in range(8):
            x0, x1 = grid_x[col], grid_x[col + 1]
            y0, y1 = grid_y[row], grid_y[row + 1]
            ix = max(1, (x1 - x0) // 6)
            iy = max(1, (y1 - y0) // 6)
            cell = image[y0 + iy : y1 - iy, x0 + ix : x1 - ix]
            if cell.size:
                means[row, col] = cell.reshape(-1, 3).mean(axis=0)
    return means


def _checker_confidence(means_gray: np.ndarray) -> float:
    yy, xx = np.mgrid[0:8, 0:8]
    parity = (xx + yy) % 2
    light = means_gray[parity == 0]
    dark = means_gray[parity == 1]
    sep = abs(float(light.mean()) - float(dark.mean()))
    spread = (float(light.std()) + float(dark.std())) / 2 + 1e-6
    return float(np.clip(sep / (sep + 4 * spread), 0.0, 1.0))


def detect(frame: ImageLike, *, min_confidence: float = 0.5) -> Optional[BoardLocation]:
    image = _as_image(frame)
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    col_profile, row_profile = _edge_profiles(gray)
    max_sq = min(w, h) // 8
    sx = _dominant_period(col_profile, max_sq)
    sy = _dominant_period(row_profile, max_sq)
    if sx is None or sy is None:
        return None
    period = int(round((sx + sy) / 2))
    grid_x = _best_phase(col_profile, period)
    grid_y = _best_phase(row_profile, period)
    if grid_x is None or grid_y is None:
        return None

    means = _cell_means(image, grid_x, grid_y)
    confidence = _checker_confidence(means.mean(axis=2))
    if confidence < min_confidence:
        return None

    bbox = Region(grid_x[0], grid_y[0], grid_x[-1] - grid_x[0], grid_y[-1] - grid_y[0])
    return BoardLocation(
        bbox=bbox,
        grid_x=grid_x,
        grid_y=grid_y,
        square_size=float(period),
        orientation_hint=None,
        highlight_squares=[],
        confidence=confidence,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/vision/test_detect.py -v`
Expected: PASS (5 passed). If `test_detect_clean_board_bbox_iou` fails on `square_size` or IoU, use systematic-debugging: print `period`, `grid_x`, `grid_y` vs the truth from `render_board`, and check whether `_dominant_period` locked onto a multiple of the true square (tighten `max_sq` or the autocorr search window).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/vision/detect.py tests/vision/test_detect.py
git commit -m "feat(vision): detect board geometry via grid periodicity + checker validation"
```

---

## Task 6: Orientation hint + highlight squares

**Files:**
- Modify: `chessmenthol/vision/detect.py`
- Test: `tests/vision/test_detect.py` (add cases)

- [ ] **Step 1: Add failing tests**

Append to `tests/vision/test_detect.py`:

```python
def test_detect_orientation_hint_white_bottom():
    img, _ = render_board(square=40, margin=24)
    loc = detect(Frame(img))
    assert loc is not None
    assert loc.orientation_hint == "white_bottom"


def test_detect_finds_highlight_squares():
    img, _ = render_board(square=40, margin=24, highlights=["e2", "e4"])
    loc = detect(Frame(img))
    assert loc is not None
    assert set(loc.highlight_squares) == {"e2", "e4"}


def test_detect_no_highlights_on_clean_board():
    img, _ = render_board(square=40, margin=24)
    loc = detect(Frame(img))
    assert loc is not None
    assert loc.highlight_squares == []
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/vision/test_detect.py -k "orientation or highlight" -v`
Expected: FAIL — orientation is `None`, highlights are `[]`.

- [ ] **Step 3: Implement the helpers and wire them into `detect`**

Add these functions to `chessmenthol/vision/detect.py`:

```python
def _orientation_hint(means_gray: np.ndarray) -> Optional[str]:
    yy, xx = np.mgrid[0:8, 0:8]
    parity = (xx + yy) % 2
    even_mean = float(means_gray[parity == 0].mean())
    odd_mean = float(means_gray[parity == 1].mean())
    if abs(even_mean - odd_mean) < 1e-3:
        return None
    # bottom-left cell is (row=7, col=0) -> parity (7+0)%2 = 1 (odd group)
    bottom_left_is_dark = odd_mean < even_mean
    return "white_bottom" if bottom_left_is_dark else "black_bottom"


def _highlight_squares(means_bgr: np.ndarray, orientation: Optional[str]) -> list[str]:
    yy, xx = np.mgrid[0:8, 0:8]
    parity = (xx + yy) % 2
    base = np.zeros_like(means_bgr)
    base[parity == 0] = means_bgr[parity == 0].mean(axis=0)
    base[parity == 1] = means_bgr[parity == 1].mean(axis=0)
    dev = np.linalg.norm(means_bgr - base, axis=2)  # (8, 8)
    thr = float(dev.mean()) + 3.0 * float(dev.std())
    candidates = [
        (dev[r, c], c, r) for r in range(8) for c in range(8) if dev[r, c] > thr
    ]
    candidates.sort(reverse=True)
    return [square_name(c, r, orientation) for _, c, r in candidates[:2]]
```

Then, in `detect`, replace the final `return BoardLocation(...)` block with:

```python
    bbox = Region(grid_x[0], grid_y[0], grid_x[-1] - grid_x[0], grid_y[-1] - grid_y[0])
    orientation = _orientation_hint(means.mean(axis=2))
    highlights = _highlight_squares(means, orientation)
    return BoardLocation(
        bbox=bbox,
        grid_x=grid_x,
        grid_y=grid_y,
        square_size=float(period),
        orientation_hint=orientation,
        highlight_squares=highlights,
        confidence=confidence,
    )
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/vision/test_detect.py -v`
Expected: PASS (all detect tests, including the 3 new ones). If a highlight is missed, lower the `3.0` sigma multiplier in `_highlight_squares`; if a clean board reports false highlights, raise it.

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/vision/detect.py tests/vision/test_detect.py
git commit -m "feat(vision): add orientation hint and last-move highlight detection"
```

---

## Task 7: `crop_squares`

**Files:**
- Modify: `chessmenthol/vision/detect.py`
- Test: `tests/vision/test_detect.py` (add cases)

- [ ] **Step 1: Add failing tests**

Append to `tests/vision/test_detect.py`:

```python
from chessmenthol.vision.detect import crop_squares


def test_crop_squares_count_and_order():
    img, _ = render_board(square=40, margin=24)
    loc = detect(Frame(img))
    crops = crop_squares(Frame(img), loc)
    assert len(crops) == 64
    # canonical order: a1, b1, ..., h1, a2, ..., h8 (python-chess index order)
    assert crops[0].square == "a1"
    assert crops[7].square == "h1"
    assert crops[63].square == "h8"


def test_crop_squares_shapes_near_square_size():
    img, _ = render_board(square=40, margin=24)
    loc = detect(Frame(img))
    for sq in crop_squares(Frame(img), loc):
        h, w = sq.image.shape[:2]
        assert 24 <= h <= 40 and 24 <= w <= 40  # square minus inset
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/vision/test_detect.py -k crop -v`
Expected: FAIL — `ImportError: cannot import name 'crop_squares'`.

- [ ] **Step 3: Implement `crop_squares`**

Add to `chessmenthol/vision/detect.py`:

```python
def _square_sort_key(name: str) -> int:
    file_idx = ord(name[0]) - ord("a")
    rank_idx = int(name[1]) - 1
    return rank_idx * 8 + file_idx  # python-chess square index (a1=0 .. h8=63)


def crop_squares(frame: ImageLike, location: BoardLocation) -> list[SquareImage]:
    image = _as_image(frame)
    crops: list[SquareImage] = []
    for row in range(8):
        for col in range(8):
            x0, x1 = location.grid_x[col], location.grid_x[col + 1]
            y0, y1 = location.grid_y[row], location.grid_y[row + 1]
            ix = max(1, (x1 - x0) // 12)
            iy = max(1, (y1 - y0) // 12)
            cell = image[y0 + iy : y1 - iy, x0 + ix : x1 - ix].copy()
            name = square_name(col, row, location.orientation_hint)
            crops.append(SquareImage(square=name, image=cell))
    crops.sort(key=lambda s: _square_sort_key(s.square))
    return crops
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/vision/test_detect.py -v`
Expected: PASS (all detect tests).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/vision/detect.py tests/vision/test_detect.py
git commit -m "feat(vision): slice located board into 64 ordered square crops"
```

---

## Task 8: Detection robustness across sizes, margins, themes, and pieces

**Files:**
- Test: `tests/vision/test_detect_robustness.py`
- Modify (if tuning needed): `chessmenthol/vision/detect.py`

- [ ] **Step 1: Write the parametrized test**

Create `tests/vision/test_detect_robustness.py`:

```python
from __future__ import annotations

import pytest

from chessmenthol.vision.detect import detect
from chessmenthol.vision.types import Frame
from tests.vision.synthetic import render_board


def _iou(a, b) -> float:
    ix0, iy0 = max(a.left, b.left), max(a.top, b.top)
    ix1 = min(a.left + a.width, b.left + b.width)
    iy1 = min(a.top + a.height, b.top + b.height)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    union = a.width * a.height + b.width * b.height - inter
    return inter / union if union else 0.0


# (square, margin)
GEOMETRY = [(24, 8), (32, 16), (40, 24), (56, 40), (64, 4)]
# (light_bgr, dark_bgr) themes
THEMES = [
    ((181, 217, 240), (99, 136, 181)),   # warm wood
    ((235, 235, 235), (120, 120, 120)),  # grey
    ((168, 184, 118), (90, 110, 60)),    # green
]
# a sparse mid-game-ish set of occupied squares
PIECES = ["e4", "d5", "g1", "b8", "a2", "h7", "c3", "f6"]


@pytest.mark.parametrize("square,margin", GEOMETRY)
def test_detect_geometry_variants(square, margin):
    img, truth = render_board(square=square, margin=margin)
    loc = detect(Frame(img))
    assert loc is not None
    assert _iou(loc.bbox, truth.bbox) > 0.95


@pytest.mark.parametrize("light,dark", THEMES)
def test_detect_theme_variants(light, dark):
    img, truth = render_board(square=40, margin=24, light=light, dark=dark)
    loc = detect(Frame(img))
    assert loc is not None
    assert _iou(loc.bbox, truth.bbox) > 0.95


def test_detect_survives_pieces():
    img, truth = render_board(square=40, margin=24, pieces=PIECES)
    loc = detect(Frame(img))
    assert loc is not None
    assert _iou(loc.bbox, truth.bbox) > 0.95
    assert loc.confidence > 0.4
```

- [ ] **Step 2: Run the test**

Run: `.venv/bin/pytest tests/vision/test_detect_robustness.py -v`
Expected: ideally PASS. Any failures are real robustness gaps — fix them in `detect.py`, do not loosen the asserts. Likely tuning levers, in order of preference:
- `_dominant_period`: if it locks onto `2 × square`, cap the search to `max_sq` more tightly or pick the smallest lag whose autocorr is within ~90% of the max (prefer the fundamental over harmonics).
- `_checker_confidence`: with pieces present, the `4 ×` spread weight may push confidence below `0.4`; if so, raise the multiplier divisor or reduce the inset in `_cell_means` so piece pixels dominate less.
- `_best_phase`: confirm the comb locks to the true outer grid lines, not an internal subset.

- [ ] **Step 3: Commit**

```bash
git add tests/vision/test_detect_robustness.py chessmenthol/vision/detect.py
git commit -m "test(vision): cover detection across sizes, themes, and piece occlusion"
```

---

## Task 9: Debug overlay rendering

**Files:**
- Create: `chessmenthol/vision/overlay.py`
- Test: `tests/vision/test_overlay.py`

- [ ] **Step 1: Write the failing test**

Create `tests/vision/test_overlay.py`:

```python
from __future__ import annotations

import numpy as np

from chessmenthol.vision.detect import detect
from chessmenthol.vision.overlay import render_overlay
from chessmenthol.vision.types import Frame
from tests.vision.synthetic import render_board


def test_overlay_returns_same_shape_modified_image():
    img, _ = render_board(square=40, margin=24, highlights=["e2", "e4"])
    loc = detect(Frame(img))
    out = render_overlay(Frame(img), loc)
    assert out.shape == img.shape
    assert out.dtype == np.uint8
    # overlay draws on the image, so it must differ from the input
    assert not np.array_equal(out, img)


def test_overlay_does_not_mutate_input():
    img, _ = render_board(square=40, margin=24)
    loc = detect(Frame(img))
    before = img.copy()
    render_overlay(Frame(img), loc)
    assert np.array_equal(img, before)
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/vision/test_overlay.py -v`
Expected: FAIL — `ModuleNotFoundError: chessmenthol.vision.overlay`.

- [ ] **Step 3: Implement the overlay**

Create `chessmenthol/vision/overlay.py`:

```python
from __future__ import annotations

import cv2
import numpy as np

from .detect import square_name
from .types import BoardLocation, Frame
from typing import Union

ImageLike = Union[Frame, np.ndarray]

_GREEN = (0, 255, 0)
_YELLOW = (0, 255, 255)
_RED = (0, 0, 255)


def _as_image(frame: ImageLike) -> np.ndarray:
    return frame.image if isinstance(frame, Frame) else frame


def render_overlay(frame: ImageLike, location: BoardLocation) -> np.ndarray:
    out = _as_image(frame).copy()
    b = location.bbox
    cv2.rectangle(out, (b.left, b.top), (b.left + b.width, b.top + b.height), _GREEN, 2)
    for x in location.grid_x:
        cv2.line(out, (x, b.top), (x, b.top + b.height), _GREEN, 1)
    for y in location.grid_y:
        cv2.line(out, (b.left, y), (b.left + b.width, y), _GREEN, 1)

    for row in range(8):
        for col in range(8):
            name = square_name(col, row, location.orientation_hint)
            x0, y0 = location.grid_x[col], location.grid_y[row]
            if name in location.highlight_squares:
                x1, y1 = location.grid_x[col + 1], location.grid_y[row + 1]
                cv2.rectangle(out, (x0, y0), (x1, y1), _YELLOW, 2)
            cv2.putText(
                out, name, (x0 + 2, y0 + 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.3, _RED, 1, cv2.LINE_AA,
            )

    header = f"conf={location.confidence:.2f} orient={location.orientation_hint}"
    cv2.putText(out, header, (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, _RED, 2, cv2.LINE_AA)
    return out
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/vision/test_overlay.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/vision/overlay.py tests/vision/test_overlay.py
git commit -m "feat(vision): add debug overlay rendering"
```

---

## Task 10: `chessmenthol-detect` CLI

**Files:**
- Create: `chessmenthol/vision/cli.py`
- Modify: `pyproject.toml` (add entry point)
- Test: `tests/vision/test_cli.py`

- [ ] **Step 1: Write the failing test**

Create `tests/vision/test_cli.py`:

```python
from __future__ import annotations

import cv2
import numpy as np

from chessmenthol.vision.capture import Capturer
from chessmenthol.vision.cli import main
from chessmenthol.vision.types import Monitor
from tests.vision.fakes import FakeBackend
from tests.vision.synthetic import render_board


def test_cli_writes_overlay_for_a_board_image(tmp_path):
    img, _ = render_board(square=40, margin=24)
    src = tmp_path / "board.png"
    cv2.imwrite(str(src), img)
    out = tmp_path / "overlay.png"
    rc = main([str(src), "-o", str(out)])
    assert rc == 0
    assert out.exists()
    assert cv2.imread(str(out)) is not None


def test_cli_dumps_square_crops(tmp_path):
    img, _ = render_board(square=40, margin=24)
    src = tmp_path / "board.png"
    cv2.imwrite(str(src), img)
    squares = tmp_path / "squares"
    rc = main([str(src), "-o", str(tmp_path / "o.png"), "--squares-dir", str(squares)])
    assert rc == 0
    assert len(list(squares.glob("*.png"))) == 64


def test_cli_returns_nonzero_on_no_board(tmp_path):
    noise = np.random.default_rng(0).integers(0, 255, (300, 300, 3), dtype=np.uint8)
    src = tmp_path / "noise.png"
    cv2.imwrite(str(src), noise)
    rc = main([str(src), "-o", str(tmp_path / "o.png")])
    assert rc == 1


def test_cli_list_monitors_uses_injected_capturer(capsys):
    backend = FakeBackend([Monitor(0, 0, 0, 1920, 1080)], [np.zeros((4, 4, 3), np.uint8)])
    rc = main(["--list-monitors"], capturer=Capturer(backend=backend))
    assert rc == 0
    assert "1920" in capsys.readouterr().out
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/vision/test_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: chessmenthol.vision.cli`.

- [ ] **Step 3: Implement the CLI**

Create `chessmenthol/vision/cli.py`:

```python
from __future__ import annotations

import argparse
import os
from typing import Optional, Sequence

import cv2

from .capture import Capturer
from .detect import crop_squares, detect
from .overlay import render_overlay
from .types import Frame, Region


def _parse_region(text: str) -> Region:
    x, y, w, h = (int(v) for v in text.split(","))
    return Region(x, y, w, h)


def _load_frame(args, capturer: Capturer) -> Frame:
    if args.image:
        image = cv2.imread(args.image)
        if image is None:
            raise SystemExit(f"could not read image: {args.image}")
        return Frame(image=image)
    if args.monitor is not None:
        capturer.select_monitor(args.monitor)
    if args.region:
        capturer.set_region(_parse_region(args.region))
    return capturer.grab()


def main(argv: Optional[Sequence[str]] = None, capturer: Optional[Capturer] = None) -> int:
    parser = argparse.ArgumentParser(prog="chessmenthol-detect")
    parser.add_argument("image", nargs="?", help="path to a screenshot image")
    parser.add_argument("--monitor", type=int, help="monitor index to grab")
    parser.add_argument("--region", help="grab region as X,Y,W,H")
    parser.add_argument("-o", "--out", default="overlay.png", help="overlay output path")
    parser.add_argument("--squares-dir", help="dump the 64 square crops here")
    parser.add_argument("--list-monitors", action="store_true")
    args = parser.parse_args(argv)

    cap = capturer if capturer is not None else Capturer()

    if args.list_monitors:
        for m in cap.list_monitors():
            print(f"[{m.index}] {m.width}x{m.height} @ ({m.left},{m.top})")
        return 0

    frame = _load_frame(args, cap)
    location = detect(frame)
    if location is None:
        print("no board detected")
        return 1

    cv2.imwrite(args.out, render_overlay(frame, location))
    if args.squares_dir:
        os.makedirs(args.squares_dir, exist_ok=True)
        for sq in crop_squares(frame, location):
            cv2.imwrite(os.path.join(args.squares_dir, f"{sq.square}.png"), sq.image)

    b = location.bbox
    print(
        f"board bbox=({b.left},{b.top},{b.width},{b.height}) "
        f"square={location.square_size:.1f} conf={location.confidence:.2f} "
        f"orient={location.orientation_hint} highlights={location.highlight_squares}"
    )
    print(f"overlay -> {args.out}")
    return 0
```

- [ ] **Step 4: Add the entry point**

In `pyproject.toml`, under `[project.scripts]`, add:

```toml
chessmenthol-detect = "chessmenthol.vision.cli:main"
```

Then reinstall so the script registers: `.venv/bin/pip install -e '.[dev]'`

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest tests/vision/test_cli.py -v`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/vision/cli.py pyproject.toml tests/vision/test_cli.py
git commit -m "feat(vision): add chessmenthol-detect debug CLI"
```

---

## Task 11: Real-screenshot reality-check fixtures

**Files:**
- Create: `tests/vision/fixtures/ground_truth.json`
- Create: `tests/vision/fixtures/*.png` (3–5 real screenshots)
- Test: `tests/vision/test_detect_real.py`

> **Input needed:** This task requires 3–5 real screenshots of online boards (Chess.com, Lichess, and at least one other viewer), each cropped/downscaled to a modest size, dropped into `tests/vision/fixtures/`. If real screenshots are unavailable in the working environment, ask the user to supply them; do **not** substitute synthetic renders here — the whole point of this task is to validate against real site rendering. For each image, hand-measure the board's bounding box once (e.g. open it in an image viewer) and record it.

- [ ] **Step 1: Add the fixtures and ground truth**

Place the PNGs in `tests/vision/fixtures/`. Create `tests/vision/fixtures/ground_truth.json` mapping each filename to its measured board bbox (looser tolerance than synthetic, so approximate-but-careful is fine):

```json
{
  "chesscom_light.png": {"left": 0, "top": 0, "width": 0, "height": 0},
  "lichess_brown.png": {"left": 0, "top": 0, "width": 0, "height": 0},
  "viewer_misc.png":   {"left": 0, "top": 0, "width": 0, "height": 0}
}
```

Replace each zeroed bbox with the real measured values.

- [ ] **Step 2: Write the reality-check test**

Create `tests/vision/test_detect_real.py`:

```python
from __future__ import annotations

import json
import pathlib

import cv2
import pytest

from chessmenthol.vision.detect import detect
from chessmenthol.vision.types import Frame, Region

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
GROUND_TRUTH = FIXTURES / "ground_truth.json"


def _iou(a: Region, b: Region) -> float:
    ix0, iy0 = max(a.left, b.left), max(a.top, b.top)
    ix1 = min(a.left + a.width, b.left + b.width)
    iy1 = min(a.top + a.height, b.top + b.height)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    union = a.width * a.height + b.width * b.height - inter
    return inter / union if union else 0.0


def _cases():
    if not GROUND_TRUTH.exists():
        return []
    return list(json.loads(GROUND_TRUTH.read_text()).items())


@pytest.mark.parametrize("name,box", _cases())
def test_detect_on_real_screenshot(name, box):
    image = cv2.imread(str(FIXTURES / name))
    assert image is not None, f"missing fixture {name}"
    loc = detect(Frame(image))
    assert loc is not None, f"no board detected in {name}"
    truth = Region(box["left"], box["top"], box["width"], box["height"])
    assert _iou(loc.bbox, truth) > 0.9, f"low IoU on {name}"
```

(The test auto-skips/collects nothing if `ground_truth.json` is absent, so the suite stays green until fixtures are added; once present, each fixture must pass.)

- [ ] **Step 3: Run the test**

Run: `.venv/bin/pytest tests/vision/test_detect_real.py -v`
Expected: PASS for each provided fixture at IoU > 0.9. Failures here are the most valuable signal in the milestone — they reveal real-theme gaps. Tune `detect.py` against them (see Task 8 levers); only widen the per-fixture tolerance with a recorded justification if a specific theme is genuinely borderline.

- [ ] **Step 4: Commit**

```bash
git add tests/vision/fixtures tests/vision/test_detect_real.py
git commit -m "test(vision): add real-screenshot reality-check fixtures"
```

---

## Task 12: Full-suite verification + manual CLI smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `.venv/bin/pytest -q`
Expected: all Python tests pass (existing 86 + the new vision tests). Engine tests still auto-skip without a bundled Stockfish — that is expected.

- [ ] **Step 2: Manual CLI smoke on a real screenshot**

If a real screenshot is available, run:
`.venv/bin/chessmenthol-detect tests/vision/fixtures/chesscom_light.png -o /tmp/overlay.png --squares-dir /tmp/squares`
Open `/tmp/overlay.png` and confirm the green grid lines sit on the real board lines, the bbox hugs the board, and any last-move highlight is boxed. Confirm `/tmp/squares` has 64 PNGs.

If on Wayland and live `--monitor` capture returns a black frame, that is the known limitation from the spec (§11) — the file path is the supported route for M3; note it and move on.

- [ ] **Step 3: Confirm no server/frontend drift**

Run: `git diff --stat main -- chessmenthol/server frontend`
Expected: empty output (M3 touched neither, per scope).

- [ ] **Step 4: Final commit (if anything was tuned during verification)**

```bash
git add -A
git commit -m "test(vision): milestone 3 full-suite verification" || echo "nothing to commit"
```

---

## Self-Review Notes (author)

- **Spec coverage:** capture (§7→Task 4), detection geometry+validation (§8→Tasks 5,8), orientation+highlight (§8→Task 6), crop_squares (§8→Task 7), CLI (§9→Task 10), synthetic+real fixtures (§10→Tasks 3,8,11), deps/entry point/packaging (§11→Tasks 1,10), deliverable/acceptance (§12→Task 12). All sections mapped.
- **Provisional-labels boundary (§6):** honored — `orientation_hint` may be `None`, labels derive from it via `square_name`, geometry is authoritative.
- **Type consistency:** `BoardLocation`/`Region`/`Frame`/`SquareImage` field and method names (`cell_rect`, `grid_x`, `grid_y`, `orientation_hint`, `square_size`) are used identically across Tasks 2–11; `square_name(col, row, orientation)` and `crop_squares(frame, location)` signatures are stable across detect/overlay/cli.
- **Known tuning risk:** the periodicity detector (Task 5/8) and the confidence/highlight thresholds may need iteration against piece-occluded and real images; Tasks 8 and 11 call this out with specific levers rather than loosening asserts.
