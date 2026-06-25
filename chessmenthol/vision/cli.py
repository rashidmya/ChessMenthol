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
