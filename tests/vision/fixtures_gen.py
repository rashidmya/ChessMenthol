"""High-fidelity chess board fixture generator.

Generates realistic site-style board images — harder than the basic render_board
used in unit tests — for reality-checking the detect() pipeline.

Each board includes:
  - Coordinate labels (file letters / rank numbers) in edge cells
  - Varied piece glyphs (pawn/knight/bishop/rook/queen/king) with AA outlines
  - Surrounding page chrome (side-panels, top-bars) so the board is embedded
  - Gaussian blur + JPEG re-encode to add realistic compression artefacts

Run directly to (re-)generate fixtures:
    .venv/bin/python -m tests.vision.fixtures_gen
"""
from __future__ import annotations

import json
import pathlib
from typing import Any

import cv2
import numpy as np

# ──────────────────────────────────────────────────────────────────────────────
# Constants / seed
# ──────────────────────────────────────────────────────────────────────────────

_SEED = 42
_FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"

# Piece type codes
PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING = "P", "N", "B", "R", "Q", "K"

# ──────────────────────────────────────────────────────────────────────────────
# Chess positions (white_bottom convention: file a-h = col 0-7, rank 1-8 = row 7-0)
# ──────────────────────────────────────────────────────────────────────────────

def _sq(file: str, rank: int) -> tuple[int, int]:
    """Return (col, row) for a square name under white_bottom."""
    col = ord(file) - ord("a")
    row = 8 - rank
    return col, row


def _starting_pieces() -> dict[tuple[int, int], tuple[str, str]]:
    """Full 32-piece starting position. Returns {(col, row): (piece_type, color)}."""
    pieces: dict[tuple[int, int], tuple[str, str]] = {}
    back_row = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK]
    for i, p in enumerate(back_row):
        pieces[_sq(chr(ord("a") + i), 1)] = (p, "black")   # rank 1 -> row 7
        pieces[_sq(chr(ord("a") + i), 8)] = (p, "white")   # rank 8 -> row 0
    for i in range(8):
        pieces[_sq(chr(ord("a") + i), 2)] = (PAWN, "black")
        pieces[_sq(chr(ord("a") + i), 7)] = (PAWN, "white")
    return pieces


def _midgame_pieces_20() -> dict[tuple[int, int], tuple[str, str]]:
    """~20 piece mid-game arrangement."""
    raw = [
        ("a1", ROOK, "white"), ("c1", BISHOP, "white"), ("e1", KING, "white"),
        ("h1", ROOK, "white"), ("a2", PAWN, "white"), ("b2", PAWN, "white"),
        ("d3", PAWN, "white"), ("f2", PAWN, "white"), ("g2", PAWN, "white"),
        ("h2", PAWN, "white"), ("e4", PAWN, "white"), ("d4", QUEEN, "white"),
        ("f3", KNIGHT, "white"),
        ("a8", ROOK, "black"), ("e8", KING, "black"), ("h8", ROOK, "black"),
        ("a7", PAWN, "black"), ("b7", PAWN, "black"), ("c6", PAWN, "black"),
        ("f7", PAWN, "black"), ("g7", PAWN, "black"), ("h7", PAWN, "black"),
        ("d6", BISHOP, "black"), ("e5", PAWN, "black"),
    ]
    pieces: dict[tuple[int, int], tuple[str, str]] = {}
    for sq_name, p, color in raw:
        col = ord(sq_name[0]) - ord("a")
        row = 8 - int(sq_name[1])
        pieces[(col, row)] = (p, color)
    return pieces


def _sparse_pieces_6() -> dict[tuple[int, int], tuple[str, str]]:
    """6 piece endgame-ish position."""
    raw = [
        ("e1", KING, "white"), ("d4", QUEEN, "white"), ("f4", ROOK, "white"),
        ("e8", KING, "black"), ("c6", PAWN, "black"), ("h7", PAWN, "black"),
    ]
    pieces: dict[tuple[int, int], tuple[str, str]] = {}
    for sq_name, p, color in raw:
        col = ord(sq_name[0]) - ord("a")
        row = 8 - int(sq_name[1])
        pieces[(col, row)] = (p, color)
    return pieces


def _midgame_pieces_16() -> dict[tuple[int, int], tuple[str, str]]:
    """~16 piece mid-game position."""
    raw = [
        ("d1", QUEEN, "white"), ("e1", KING, "white"), ("a1", ROOK, "white"),
        ("h1", ROOK, "white"), ("f3", KNIGHT, "white"), ("c1", BISHOP, "white"),
        ("e2", PAWN, "white"), ("f2", PAWN, "white"), ("g2", PAWN, "white"),
        ("h2", PAWN, "white"), ("c4", PAWN, "white"),
        ("e8", KING, "black"), ("a8", ROOK, "black"),
        ("d7", PAWN, "black"), ("e5", PAWN, "black"), ("g6", KNIGHT, "black"),
    ]
    pieces: dict[tuple[int, int], tuple[str, str]] = {}
    for sq_name, p, color in raw:
        col = ord(sq_name[0]) - ord("a")
        row = 8 - int(sq_name[1])
        pieces[(col, row)] = (p, color)
    return pieces


# ──────────────────────────────────────────────────────────────────────────────
# Piece rendering
# ──────────────────────────────────────────────────────────────────────────────

def _draw_piece(
    img: np.ndarray,
    cx: int,
    cy: int,
    sq: int,          # square pixel size
    piece: str,
    color: str,       # "white" | "black"
) -> None:
    """Draw a distinct piece glyph centered at (cx, cy) with anti-aliasing."""
    r = int(sq * 0.35)           # base radius ~70% of cell
    fill = (240, 240, 230) if color == "white" else (30, 25, 20)
    outline = (30, 20, 15) if color == "white" else (210, 210, 200)
    line = cv2.LINE_AA
    thick_out = max(1, sq // 14)
    thick_fill = max(1, sq // 20)

    if piece == PAWN:
        # Circle body
        cv2.circle(img, (cx, cy), r, outline, -1, line)
        cv2.circle(img, (cx, cy), r - thick_out, fill, -1, line)
        # Small base tab
        bw = int(r * 0.7)
        by = cy + r - 1
        pts = np.array([[cx - bw, by + thick_out], [cx + bw, by + thick_out],
                         [cx + bw - 2, by], [cx - bw + 2, by]], np.int32)
        cv2.fillPoly(img, [pts], outline, line)
        pts2 = pts.copy()
        pts2[:, 1] -= thick_out
        cv2.fillPoly(img, [pts2], fill, line)

    elif piece == ROOK:
        # Rectangle body
        hw = int(r * 0.75)
        hh = int(r * 0.85)
        cv2.rectangle(img, (cx - hw, cy - hh), (cx + hw, cy + hh), outline, -1)
        cv2.rectangle(img, (cx - hw + thick_out, cy - hh + thick_out),
                      (cx + hw - thick_out, cy + hh - thick_out), fill, -1)
        # Battlements
        bw = hw // 3
        bh = thick_out + 2
        for bx in [cx - hw, cx - bw // 2, cx + hw - bw]:
            cv2.rectangle(img, (bx, cy - hh - bh), (bx + bw, cy - hh), outline, -1)

    elif piece == KNIGHT:
        # Stylised L-shape head
        hw = int(r * 0.7)
        hh = int(r * 0.9)
        # Body trapezoid
        pts_out = np.array([
            [cx - int(hw * 0.5), cy + hh],
            [cx + int(hw * 0.5), cy + hh],
            [cx + hw, cy - int(hh * 0.3)],
            [cx + int(hw * 0.3), cy - hh],
            [cx - int(hw * 0.6), cy - int(hh * 0.5)],
        ], np.int32)
        cv2.fillPoly(img, [pts_out], outline, line)
        pts_in = (pts_out + np.array([[thick_out, -thick_out],
                                       [-thick_out, -thick_out],
                                       [-thick_out, thick_out],
                                       [-thick_out, thick_out],
                                       [thick_out, thick_out]])).astype(np.int32)
        cv2.fillPoly(img, [pts_in], fill, line)
        # Eye dot
        eye_x, eye_y = cx + int(hw * 0.15), cy - int(hh * 0.4)
        cv2.circle(img, (eye_x, eye_y), max(1, sq // 18), outline, -1, line)

    elif piece == BISHOP:
        # Diamond / mitre shape
        hw = int(r * 0.65)
        hh = int(r * 0.95)
        pts_out = np.array([
            [cx, cy - hh],
            [cx + hw, cy],
            [cx + int(hw * 0.7), cy + hh],
            [cx - int(hw * 0.7), cy + hh],
            [cx - hw, cy],
        ], np.int32)
        cv2.fillPoly(img, [pts_out], outline, line)
        pts_in = np.array([
            [cx, cy - hh + thick_out * 2],
            [cx + hw - thick_out, cy],
            [cx + int(hw * 0.7) - thick_out, cy + hh - thick_out],
            [cx - int(hw * 0.7) + thick_out, cy + hh - thick_out],
            [cx - hw + thick_out, cy],
        ], np.int32)
        cv2.fillPoly(img, [pts_in], fill, line)
        # Top dot
        cv2.circle(img, (cx, cy - hh + thick_out), max(1, sq // 18), outline, -1, line)

    elif piece == QUEEN:
        # Hexagon crown shape
        hw = int(r * 0.85)
        hh = int(r * 0.90)
        pts_out = np.array([
            [cx, cy - hh],
            [cx + hw, cy - int(hh * 0.3)],
            [cx + int(hw * 0.8), cy + hh],
            [cx - int(hw * 0.8), cy + hh],
            [cx - hw, cy - int(hh * 0.3)],
        ], np.int32)
        cv2.fillPoly(img, [pts_out], outline, line)
        pts_in = np.array([
            [cx, cy - hh + thick_out * 2],
            [cx + hw - thick_out, cy - int(hh * 0.3) + thick_out],
            [cx + int(hw * 0.8) - thick_out, cy + hh - thick_out],
            [cx - int(hw * 0.8) + thick_out, cy + hh - thick_out],
            [cx - hw + thick_out, cy - int(hh * 0.3) + thick_out],
        ], np.int32)
        cv2.fillPoly(img, [pts_in], fill, line)
        # Three crown points
        for dx in [-hw, 0, hw]:
            cv2.circle(img, (cx + dx, cy - int(hh * 0.35)), max(2, sq // 14),
                       outline, -1, line)
            cv2.circle(img, (cx + dx, cy - int(hh * 0.35)), max(1, sq // 20),
                       fill, -1, line)

    elif piece == KING:
        # Cross on top of body
        hw = int(r * 0.7)
        hh = int(r * 0.8)
        # Body rectangle
        cv2.rectangle(img, (cx - hw, cy - int(hh * 0.3)),
                      (cx + hw, cy + hh), outline, -1)
        cv2.rectangle(img, (cx - hw + thick_out, cy - int(hh * 0.3) + thick_out),
                      (cx + hw - thick_out, cy + hh - thick_out), fill, -1)
        # Cross
        cw = max(2, sq // 10)
        ch = int(hh * 0.55)
        cv2.rectangle(img, (cx - cw, cy - hh - ch), (cx + cw, cy - int(hh * 0.3)),
                      outline, -1)
        cv2.rectangle(img, (cx - cw + thick_fill, cy - hh - ch + thick_fill),
                      (cx + cw - thick_fill, cy - int(hh * 0.3) - thick_fill),
                      fill, -1)
        cv2.rectangle(img, (cx - int(cw * 2.2), cy - hh - ch // 2),
                      (cx + int(cw * 2.2), cy - hh - ch // 2 + cw * 2),
                      outline, -1)
        cv2.rectangle(img, (cx - int(cw * 2.2) + thick_fill, cy - hh - ch // 2 + thick_fill),
                      (cx + int(cw * 2.2) - thick_fill, cy - hh - ch // 2 + cw * 2 - thick_fill),
                      fill, -1)


# ──────────────────────────────────────────────────────────────────────────────
# Core board renderer
# ──────────────────────────────────────────────────────────────────────────────

def _render_realistic_board(
    canvas: np.ndarray,
    board_left: int,
    board_top: int,
    sq: int,
    light_bgr: tuple[int, int, int],
    dark_bgr: tuple[int, int, int],
    pieces: dict[tuple[int, int], tuple[str, str]],
    highlights: list[tuple[int, int]] | None = None,
    highlight_bgr: tuple[int, int, int] = (160, 210, 100),
    label_color: tuple[int, int, int] = (80, 80, 80),
) -> None:
    """Paint board squares, coordinate labels, and pieces onto canvas in place."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(0.20, sq / 120.0)
    font_thick = 1

    # Squares
    for row in range(8):
        for col in range(8):
            x0 = board_left + col * sq
            y0 = board_top + row * sq
            is_light = (col + row) % 2 == 0
            color = light_bgr if is_light else dark_bgr
            canvas[y0:y0 + sq, x0:x0 + sq] = color

    # Highlight tint
    if highlights:
        hl_color = np.array(highlight_bgr, dtype=np.float32)
        for (col, row) in highlights:
            x0 = board_left + col * sq
            y0 = board_top + row * sq
            cell = canvas[y0:y0 + sq, x0:x0 + sq].astype(np.float32)
            canvas[y0:y0 + sq, x0:x0 + sq] = (
                0.55 * cell + 0.45 * hl_color
            ).astype(np.uint8)

    # Coordinate labels — drawn in corner of edge squares, semi-transparent style
    lbl_offset = max(2, sq // 10)
    for col in range(8):
        file_letter = chr(ord("a") + col)
        # Bottom row (row 7) — draw file letter at bottom-left
        x0 = board_left + col * sq
        y0 = board_top + 7 * sq
        # Determine contrasting label color per square color
        is_light = (col + 7) % 2 == 0
        lc = dark_bgr if is_light else light_bgr
        cv2.putText(
            canvas, file_letter,
            (x0 + lbl_offset, y0 + sq - lbl_offset),
            font, font_scale, lc, font_thick, cv2.LINE_AA,
        )
    for row in range(8):
        rank_digit = str(8 - row)
        # Right-most column (col 7) — draw rank at top-right
        x0 = board_left + 7 * sq
        y0 = board_top + row * sq
        is_light = (7 + row) % 2 == 0
        lc = dark_bgr if is_light else light_bgr
        (tw, th), _ = cv2.getTextSize(rank_digit, font, font_scale, font_thick)
        cv2.putText(
            canvas, rank_digit,
            (x0 + sq - tw - lbl_offset, y0 + th + lbl_offset),
            font, font_scale, lc, font_thick, cv2.LINE_AA,
        )

    # Pieces
    for (col, row), (piece_type, color) in pieces.items():
        cx = board_left + col * sq + sq // 2
        cy = board_top + row * sq + sq // 2
        _draw_piece(canvas, cx, cy, sq, piece_type, color)


def _apply_artifacts(img: np.ndarray, blur_ksize: int = 3, jpeg_quality: int = 85) -> np.ndarray:
    """Gaussian blur + JPEG round-trip to add compression artifacts."""
    blurred = cv2.GaussianBlur(img, (blur_ksize, blur_ksize), 0)
    ok, buf = cv2.imencode(".jpg", blurred, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if not ok:
        return blurred
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


# ──────────────────────────────────────────────────────────────────────────────
# Individual fixture builders
# ──────────────────────────────────────────────────────────────────────────────

def _build_chesscom_brown_start() -> tuple[np.ndarray, dict[str, int]]:
    """Warm brown/cream, 32-piece starting position, light page with right side-panel."""
    sq = 44
    board_px = sq * 8
    panel_w = 90
    top_margin = 30
    left_margin = 20
    bottom_margin = 20
    canvas_w = left_margin + board_px + panel_w + 10
    canvas_h = top_margin + board_px + bottom_margin

    # Page background (light cream)
    canvas = np.full((canvas_h, canvas_w, 3), (230, 225, 215), dtype=np.uint8)

    # Right side panel — darker sidebar
    canvas[:, left_margin + board_px:] = (180, 170, 155)
    # A thin border between board and panel
    canvas[:, left_margin + board_px: left_margin + board_px + 3] = (120, 110, 100)

    # Top bar suggestion (thin)
    canvas[:top_margin, :] = (100, 85, 70)

    board_left = left_margin
    board_top = top_margin

    # Brown/cream theme (BGR)
    light = (206, 209, 240)   # cream
    dark = (80, 110, 180)     # warm brown in BGR

    _render_realistic_board(
        canvas, board_left, board_top, sq,
        light, dark,
        _starting_pieces(),
    )

    canvas = _apply_artifacts(canvas)
    gt = {"left": board_left, "top": board_top, "width": board_px, "height": board_px}
    return canvas, gt


def _build_lichess_brown_midgame() -> tuple[np.ndarray, dict[str, int]]:
    """Brown theme, ~20-piece mid-game, last-move highlight, top bar chrome."""
    sq = 38
    board_px = sq * 8
    top_bar = 48
    left_margin = 16
    right_margin = 16
    bottom_margin = 24
    canvas_w = left_margin + board_px + right_margin
    canvas_h = top_bar + board_px + bottom_margin

    # Dark background
    canvas = np.full((canvas_h, canvas_w, 3), (40, 38, 35), dtype=np.uint8)

    # Top bar (slightly lighter)
    canvas[:top_bar, :] = (60, 55, 50)
    # Divider line
    canvas[top_bar - 2: top_bar, :] = (90, 80, 70)

    board_left = left_margin
    board_top = top_bar

    # Lichess brown (BGR)
    light = (185, 195, 209)
    dark = (90, 115, 148)

    # Highlight last-move squares e2, e4 (col=4, row=6 and col=4, row=4)
    highlights = [(4, 6), (4, 4)]
    highlight_bgr = (60, 180, 210)

    _render_realistic_board(
        canvas, board_left, board_top, sq,
        light, dark,
        _midgame_pieces_20(),
        highlights=highlights,
        highlight_bgr=highlight_bgr,
    )

    canvas = _apply_artifacts(canvas)
    gt = {"left": board_left, "top": board_top, "width": board_px, "height": board_px}
    return canvas, gt


def _build_green_sparse() -> tuple[np.ndarray, dict[str, int]]:
    """Green theme, 6 pieces, tight margin, left sidebar of distinct shade."""
    sq = 48
    board_px = sq * 8
    sidebar_w = 80
    top_margin = 18
    bottom_margin = 18
    right_margin = 18
    canvas_w = sidebar_w + board_px + right_margin
    canvas_h = top_margin + board_px + bottom_margin

    # Light grey page
    canvas = np.full((canvas_h, canvas_w, 3), (210, 208, 205), dtype=np.uint8)

    # Left sidebar — distinct teal-ish shade
    canvas[:, :sidebar_w] = (140, 155, 100)
    # Sidebar divider
    canvas[:, sidebar_w: sidebar_w + 3] = (100, 110, 70)

    board_left = sidebar_w
    board_top = top_margin

    # Chess.com green (BGR approx)
    light = (118, 217, 181)   # light green
    dark = (86, 146, 90)      # dark green

    _render_realistic_board(
        canvas, board_left, board_top, sq,
        light, dark,
        _sparse_pieces_6(),
    )

    canvas = _apply_artifacts(canvas)
    gt = {"left": board_left, "top": board_top, "width": board_px, "height": board_px}
    return canvas, gt


def _build_grey_blue_midgame() -> tuple[np.ndarray, dict[str, int]]:
    """Grey/blue theme, 16 pieces, different square size and canvas."""
    sq = 36
    board_px = sq * 8
    top_margin = 55
    left_margin = 40
    right_margin = 60
    bottom_margin = 30
    canvas_w = left_margin + board_px + right_margin
    canvas_h = top_margin + board_px + bottom_margin

    # Blue-grey page background
    canvas = np.full((canvas_h, canvas_w, 3), (175, 165, 150), dtype=np.uint8)

    # Top navigation bar
    canvas[:top_margin, :] = (80, 75, 68)
    # Thin accent line under top bar
    canvas[top_margin - 3: top_margin, :] = (120, 150, 180)

    # Right info panel
    canvas[:, left_margin + board_px:] = (155, 148, 138)
    # Panel border
    canvas[:, left_margin + board_px: left_margin + board_px + 2] = (70, 70, 70)

    board_left = left_margin
    board_top = top_margin

    # Grey/blue theme
    light = (200, 190, 175)
    dark = (120, 110, 95)

    _render_realistic_board(
        canvas, board_left, board_top, sq,
        light, dark,
        _midgame_pieces_16(),
    )

    canvas = _apply_artifacts(canvas)
    gt = {"left": board_left, "top": board_top, "width": board_px, "height": board_px}
    return canvas, gt


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def generate_fixtures(out_dir: pathlib.Path | str | None = None) -> dict[str, dict[str, Any]]:
    """Render all fixtures, write PNGs + ground_truth.json, return gt dict."""
    if out_dir is None:
        out_dir = _FIXTURES_DIR
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    builders: list[tuple[str, Any]] = [
        ("chesscom_brown_start.png", _build_chesscom_brown_start),
        ("lichess_brown_midgame.png", _build_lichess_brown_midgame),
        ("green_sparse.png", _build_green_sparse),
        ("grey_blue_midgame.png", _build_grey_blue_midgame),
    ]

    ground_truth: dict[str, dict[str, Any]] = {}
    for filename, builder in builders:
        img, gt = builder()
        path = out_dir / filename
        cv2.imwrite(str(path), img)
        ground_truth[filename] = gt
        h, w = img.shape[:2]
        print(f"  {filename}: canvas={w}x{h}, board={gt}")

    gt_path = out_dir / "ground_truth.json"
    gt_path.write_text(json.dumps(ground_truth, indent=2))
    print(f"  ground_truth.json written to {gt_path}")
    return ground_truth


if __name__ == "__main__":
    print("Generating fixtures...")
    generate_fixtures()
    print("Done.")
