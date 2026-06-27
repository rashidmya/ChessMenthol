from __future__ import annotations

from typing import Optional, Union

import chess
import numpy as np

from chessmenthol.position import (
    AssembledPosition,
    assemble,
    guess_orientation,
    guess_side_to_move,
)

from .capture import Capturer
from .detect import crop_squares, detect
from .pieces import PieceClassifier
from .types import Frame, square_name

ImageLike = Union[Frame, np.ndarray]


class Tracker:
    """Turns one captured frame into an AssembledPosition.

    Pipeline: grab -> detect -> crop_squares -> classify -> bridge to an 8x8
    geometric grid -> assemble. Orientation/side overrides let the UI correct
    the detection; they persist across frames (via prev_board for move inference).
    """

    def __init__(
        self,
        capturer: Optional[Capturer] = None,
        classifier: Optional[PieceClassifier] = None,
    ) -> None:
        self._capturer = capturer if capturer is not None else Capturer()
        self._classifier = classifier if classifier is not None else PieceClassifier()
        self._prev_board: Optional[chess.Board] = None
        self._orientation_override: Optional[str] = None
        self._side_override: Optional[chess.Color] = None

    def set_orientation_override(self, orientation: Optional[str]) -> None:
        self._orientation_override = orientation

    def set_side_override(self, side: Optional[chess.Color]) -> None:
        self._side_override = side

    def set_region(self, region) -> None:
        self._capturer.set_region(region)

    def grab_full_desktop(self):
        return self._capturer.grab_full_desktop()

    def reset(self) -> None:
        self._prev_board = None

    def detect_position(
        self, frame: Optional[ImageLike] = None
    ) -> Optional[AssembledPosition]:
        if frame is None:
            frame = self._capturer.grab()
        location = detect(frame)
        if location is None:
            return None
        crops = crop_squares(frame, location)
        labels = self._classifier.classify(crops)

        # Bridge: recover the geometric grid using the SAME orientation crop_squares
        # named the crops with (location.orientation_hint). assemble then applies the
        # resolved orientation, so an override flips the chess mapping without re-cropping.
        label_by_name = {c.square: lab for c, lab in zip(crops, labels)}
        grid = [
            [label_by_name[square_name(col, row, location.orientation_hint)] for col in range(8)]
            for row in range(8)
        ]

        orientation = (
            self._orientation_override
            or location.orientation_hint
            or guess_orientation(grid)
            or "white_bottom"
        )
        side = self._resolve_side(grid, orientation, location)
        assembled = assemble(
            grid, orientation=orientation, side_to_move=side, prev_board=self._prev_board
        )
        if assembled.is_legal:
            self._prev_board = assembled.board
        return assembled

    def _resolve_side(self, grid, orientation, location) -> chess.Color:
        if self._side_override is not None:
            return self._side_override
        # Two-pass: assemble provisionally to get a board for the highlight/move guess.
        provisional = assemble(
            grid, orientation=orientation, side_to_move=chess.WHITE, prev_board=self._prev_board
        )
        if provisional.board is None:
            return chess.WHITE
        return guess_side_to_move(
            provisional.board,
            prev_board=self._prev_board,
            move=provisional.move,
            highlight_squares=location.highlight_squares,
        )
