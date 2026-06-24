# Milestone 3 — Screen Capture + Board Detection — Design Spec

**Date:** 2026-06-25
**Status:** Approved for planning
**Parent:** [`2026-06-24-chessmenthol-design.md`](2026-06-24-chessmenthol-design.md) §6.1 `capture`, §6.2 `board_detect`, §11 build-order item 3

## 1. Overview

Milestone 3 builds the two computer-vision modules that turn a screenshot into a located
chessboard: **`capture`** (grab frames from a monitor or sub-region) and **`board_detect`**
(find the 8×8 board geometrically and slice it into 64 square images). It ships a developer
CLI, **`chessmenthol-detect`**, that runs the pipeline on an image (or a live grab) and writes an
annotated overlay for visual verification.

This milestone deliberately stops at *geometry*. Piece classification, FEN assembly, and wiring the
detector into the live orchestration loop / frontend are **Milestone 4**. M3 produces clean,
independently-tested modules and a debug tool — nothing in `server/` or `frontend/` changes.

## 2. Goals

- Capture a chosen monitor or an explicit bounding-box region as a BGR image, skipping frames that
  have not changed.
- Locate an axis-aligned 8×8 board **geometrically** (theme-independent), returning its bounding box,
  the 9×9 grid lines, a confidence score, an orientation hint, and any last-move highlight squares.
- Slice the located board into 64 square images in canonical order.
- Provide a `chessmenthol-detect` CLI that produces an annotated overlay PNG and a text summary, for
  developer verification across real online-chess screenshots.
- Be fully testable headless (no real screen, no GUI libraries) and remain PyInstaller-compatible.

## 3. Non-Goals (this milestone)

- **No piece classification, no FEN, no position assembly** — Milestone 4.
- **No server/WebSocket/frontend integration** — Milestone 4 wires the detector into the live loop.
- **No interactive drag-to-select-region UI** — deferred to Milestone 5 (Polish). M3 supports monitor
  selection and explicit programmatic regions only.
- **No perspective/rotation handling.** Per the parent spec's non-goals, only online boards in
  screenshots are supported; these are always rendered axis-aligned. No homography, no webcam input.
- **No OCR** of coordinate labels. Orientation is hinted from corner-square color parity instead.

## 4. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| M3 deliverable boundary | Standalone `capture` + `board_detect` modules + `chessmenthol-detect` dev CLI. No server/frontend wiring (that is M4). |
| Test fixtures | **Both**: deterministic in-memory **synthetic** board renders for breadth + a small set of committed **real** screenshots as a reality-check. |
| Region selection | Monitor selection + explicit bbox region in M3; interactive drag-select deferred to M5. |
| Detection algorithm | **Periodicity + checker-validation**, axis-aligned only (Option C). Library corner-finders rejected — they fail under mid-game piece occlusion. |
| Capture backend | `mss`, behind a `CaptureBackend` Protocol so a Wayland/portal backend can drop in at M5. |
| Image convention | Internal images are **BGR uint8 ndarrays** (matches OpenCV); `mss` BGRA is converted on grab. |
| OpenCV build | `opencv-python-headless` (no GUI/Qt libs → smaller binary, PyInstaller-clean). Overlay is drawn onto the array and saved as PNG, not shown via `imshow`. |

## 5. Module layout

A new `chessmenthol/vision/` package, following the existing package-per-domain convention
(`engine/`, `analysis/`, `server/`). Milestone 4's piece classifier joins this package later.

```
chessmenthol/vision/
  __init__.py
  types.py     # Frame, Region, Monitor, BoardLocation, SquareImage
  capture.py   # CaptureBackend (Protocol), MssBackend, Capturer
  detect.py    # detect(frame) -> BoardLocation|None, crop_squares(...)
  overlay.py   # render_overlay(frame, location) -> annotated ndarray
  cli.py       # `chessmenthol-detect` entry point
```

Tests live under `tests/vision/`, with the synthetic renderer as a test helper (not shipped) and a
few committed real screenshots:

```
tests/vision/
  __init__.py
  synthetic.py            # deterministic in-memory board renderer + ground truth
  fixtures/
    *.png                 # ~3-5 downscaled real screenshots
    ground_truth.json     # board bbox per fixture file
  test_capture.py
  test_detect.py
  test_overlay.py
  test_cli.py
```

## 6. Data types (`vision/types.py`)

All frozen dataclasses unless noted. Coordinates are integer frame pixels; `(file, rank)` are
0-indexed from the board's geometric top-left.

- `Region(left, top, width, height)`
- `Monitor(index, left, top, width, height)`
- `Frame(image: np.ndarray, origin: tuple[int, int] = (0, 0))` — `image` is BGR `uint8` `(H, W, 3)`;
  `origin` is the screen coordinate of the frame's top-left (so live screen coords can be recovered
  later; `(0, 0)` for file-loaded images).
- `BoardLocation`:
  - `bbox: Region` — board bounding box within the frame.
  - `grid_x: list[int]` (9 vertical grid-line x-positions), `grid_y: list[int]` (9 horizontal
    grid-line y-positions) — together define all 64 cell rectangles.
  - `square_size: float` — mean cell pitch in pixels.
  - `orientation_hint: Literal["white_bottom", "black_bottom"] | None` — best guess from corner-cell
    color parity; `None` when ambiguous.
  - `highlight_squares: list[str]` — 0–2 provisional algebraic names of detected last-move highlight
    cells.
  - `confidence: float` — checker-validation score in `[0, 1]`.
  - Helper: `cell_rect(file: int, rank: int) -> Region`.
- `SquareImage(square: str, image: np.ndarray)` — one cropped cell; `square` is a provisional
  algebraic name.

**Provisional-labels boundary (important):** detection resolves the board *geometry* exactly (64
cells in raster order). The true algebraic mapping and side-to-move depend on piece layout, which is
Milestone 4. So `orientation_hint` and every algebraic label produced here are **provisional**,
derived from corner-color parity and defaulting to `white_bottom` when ambiguous. Geometry is
authoritative; labels are a best guess to be finalized in M4.

## 7. Capture (`vision/capture.py`)

- `class CaptureBackend(Protocol)`: `list_monitors() -> list[Monitor]`; `grab(region: Region) ->
  np.ndarray` (returns BGR).
- `class MssBackend(CaptureBackend)`: wraps `mss.mss()` with lazy initialization; converts BGRA→BGR.
  Single-threaded use in M3 (mss instances are not shared across threads).
- `class Capturer`:
  - `__init__(backend: CaptureBackend | None = None)` — defaults to `MssBackend`; tests inject a
    `FakeBackend`.
  - `list_monitors() -> list[Monitor]`
  - `select_monitor(index: int) -> None`
  - `set_region(region: Region | None) -> None` — `None` means the full selected monitor.
  - `grab() -> Frame` — grabs the current region (or full monitor), tagging `Frame.origin`.
  - `grab_if_changed(threshold: float) -> Frame | None` — keeps a downsampled grayscale of the last
    grabbed frame; returns `None` when the mean per-pixel difference is below `threshold`, otherwise
    the new `Frame`. This is the change-detection that lets the M4 loop skip redundant analysis.

Tests exercise everything through a `FakeBackend` returning scripted frames, so the suite runs fully
headless. `MssBackend` itself is only touched by an optional live-capture integration test.

## 8. Detection (`vision/detect.py`) — periodicity + checker-validation

`detect(frame: Frame | np.ndarray, *, min_confidence: float = ...) -> BoardLocation | None`:

1. Convert to grayscale; compute an edge/gradient magnitude map (e.g. Sobel).
2. Project edge energy onto the x and y axes; use autocorrelation of each 1-D signal to recover the
   dominant **square pitch and phase**. Because the grid dominates the periodicity, pieces resting on
   squares do not break it.
3. From the periodic peaks, find the longest run of ~8 equal intervals on each axis → the board's 9
   vertical and 9 horizontal grid lines, hence the `bbox`.
4. **Validate**: compute the 64 cell mean-colors and confirm they alternate in a two-color checker
   pattern. The strength of that alternation is `confidence`; below `min_confidence` → return `None`
   (rejects false positives and non-board frames).
5. Cheap extras the interface requires: `orientation_hint` from corner-cell color parity;
   `highlight_squares` as the (≤2) cells whose color deviates most from the two detected base colors
   (last-move highlights are tinted).

`crop_squares(frame, location: BoardLocation) -> list[SquareImage]`: slices the 64 cells with a small
inset (to avoid grid-line bleed), assigns provisional algebraic labels from `orientation_hint`, and
returns them in canonical `a1..h8` order.

Robustness is iterative and tracked against the fixtures (§10); M3's bar is meeting the tolerances
there, not perfection on every theme in the wild.

## 9. Debug CLI (`vision/cli.py` → `chessmenthol-detect`)

```
chessmenthol-detect <image> [-o overlay.png] [--squares-dir DIR]
chessmenthol-detect --monitor N [--region X,Y,W,H] [-o overlay.png]
chessmenthol-detect --list-monitors
```

- Loads the image (or grabs `--monitor`/`--region` live), runs `detect`, and:
  - on success: writes the annotated overlay (board bbox, 9×9 grid lines, provisional cell labels,
    highlight cells, a header with confidence/orientation), optionally dumps the 64 crops to
    `--squares-dir`, prints a text summary, exits `0`.
  - on no board: prints a "no board detected" message, exits non-zero.
- Registered in `[project.scripts]` as `chessmenthol-detect = "chessmenthol.vision.cli:main"`.

`overlay.render_overlay(frame, location) -> np.ndarray` does the drawing (pure, returns a new BGR
array) so it is testable without the CLI.

## 10. Fixtures & testing strategy (TDD)

**Synthetic** (`tests/vision/synthetic.py`, dev-only helper): `render_board(...)` deterministically
draws an 8×8 two-color grid on a background with configurable theme colors, board size, and margins;
optional simple piece blobs (to test occlusion robustness) and tinted cells (to test highlight
detection). Returns `(image, BoardLocation)` where the `BoardLocation` is exact ground truth. No
randomness that depends on wall-clock; all variation comes from explicit parameters.

**Real** (`tests/vision/fixtures/`): ~3–5 downscaled screenshots from real sites (Chess.com, Lichess,
and at least one arbitrary viewer) plus `ground_truth.json` mapping each file to its board bbox.

**Tests:**

- `test_capture.py` — via `FakeBackend`: monitor listing; `set_region`/`select_monitor`; `grab`
  returns a tagged `Frame`; `grab_if_changed` returns `None` on an identical frame and a `Frame` on a
  changed one.
- `test_detect.py` — on synthetic: board `bbox` IoU > 0.95 across theme/size/margin variants;
  detection still succeeds with pieces present; all 64 cell centers within tolerance of ground truth;
  a noise / non-board image returns `None`. On real fixtures: `bbox` IoU > ~0.9 per file. Plus
  highlight-square detection and orientation-hint correctness on crafted synthetic inputs;
  `crop_squares` returns 64 images in correct order with ~`square_size` shape.
- `test_overlay.py` — `render_overlay` returns a same-size BGR array and draws (non-identical to
  input).
- `test_cli.py` — runs on a fixture: writes the output file, exit `0`; on a noise image, exits
  non-zero; `--list-monitors` works through an injected backend.
- An optional `@pytest.mark.capture` live-grab integration test exercises `MssBackend`; it is skipped
  on headless/Wayland environments.

The whole suite runs headless in CI — every test operates on in-memory arrays or committed files, and
`MssBackend` is never invoked outside the opt-in marked test.

## 11. Dependencies & packaging

Add to `[project] dependencies`:

- `mss>=9` — cross-platform screen capture.
- `opencv-python-headless>=4.9` — CV primitives, no GUI libraries.
- `numpy>=1.26` — declared explicitly (also transitive via OpenCV).

All three are PyInstaller-compatible; the headless OpenCV build avoids pulling Qt/GTK, keeping the M5
binaries small. **Wayland note:** `mss` is X11/Win/macOS-based and may return black frames under
native Wayland; this does not block M3 because the pipeline runs on image files (and that is how it is
tested), and the `CaptureBackend` Protocol lets a Wayland portal / `grim` backend land at M5.

New entry point: `chessmenthol-detect`.

## 12. Deliverable / acceptance

- `chessmenthol-detect screenshot.png -o overlay.png` produces a correct annotated board overlay on
  real Chess.com / Lichess screenshots.
- The detection suite passes within the stated IoU/center tolerances on synthetic and real fixtures.
- `Capturer` returns frames from a chosen monitor and from an explicit region (verified live where the
  platform's display server allows).
- Zero changes to `chessmenthol/server/` or `frontend/`.

## 13. Risks & open questions

- **Real-theme robustness.** Periodicity + checker-validation is strong on clean 2-D themes; unusual
  boards (very low contrast, heavy 3-D piece shadows) may need threshold tuning. Mitigation: the
  real-screenshot fixtures and a tracked IoU metric; tune against failures rather than guessing.
- **Change-detection threshold.** `grab_if_changed`'s threshold trades responsiveness vs. wasted work;
  the default is a starting point to be tuned when the M4 live loop exists.
- **Highlight detection** is best-effort and only a *hint* for M4's side-to-move inference; it is not
  required to be perfect and is allowed to return zero squares.
- **Wayland capture** on the developer's own machine (CachyOS) may not work live; covered by the
  file-based pipeline and a future backend, but worth confirming early when grabbing live frames.
