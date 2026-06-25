from __future__ import annotations

from typing import Optional, Union

import cv2
import numpy as np

from .types import BoardLocation, Frame, Region

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
    """Find the dominant period in the profile via autocorrelation.

    To avoid locking onto harmonics (multiples of the true period), we prefer
    the *smallest* lag whose autocorrelation is within 90% of the maximum in
    the inclusive range [_MIN_SQUARE, max_sq].
    """
    p = profile.astype(np.float64)
    p = p - p.mean()
    n = len(p)
    ac = np.correlate(p, p, mode="full")[n - 1 :]  # autocorrelation, lags 0..n-1
    lo, hi = _MIN_SQUARE, min(max_sq + 1, n - 1)  # +1 makes max_sq an included lag
    if hi <= lo:
        return None
    window = ac[lo:hi]
    peak = float(window.max())
    if peak <= 0:
        return None
    # Prefer the smallest lag within 90% of the peak — avoids harmonic lockout
    threshold = 0.90 * peak
    candidates = np.where(window >= threshold)[0]
    best_lag = int(candidates[0])  # smallest qualifying lag
    return lo + best_lag


def _best_phase(profile: np.ndarray, period: int, teeth: int = 9) -> Optional[list[int]]:
    n = len(profile)
    span = period * (teeth - 1)
    if span > n:
        return None
    teeth_idx = period * np.arange(teeth)
    best_start, best_score = 0, -1.0
    # Inclusive of start=0; when span == n (board flush to the frame edges) the
    # only valid phase is start=0, whose last tooth sits on the frame border.
    for start in range(0, n - span + 1):
        # Clamp the final tooth to stay in bounds for a flush board (idx == n).
        idx = np.minimum(start + teeth_idx, n - 1)
        score = float(profile[idx].sum())
        if score > best_score:
            best_score, best_start = score, start
    return [int(min(x, n - 1)) for x in (best_start + teeth_idx)]


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
