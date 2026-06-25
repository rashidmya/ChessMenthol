from __future__ import annotations

from pathlib import Path
from typing import Optional

import chess
import cv2
import numpy as np

from chessmenthol.position import SquareLabel
from chessmenthol.vision.types import SquareImage

INPUT_SIZE = 32

# chess-cv's pieces-model output order (alphabetical); "xx" == empty.
CLASSES = [
    "bB", "bK", "bN", "bP", "bQ", "bR",
    "wB", "wK", "wN", "wP", "wQ", "wR", "xx",
]

_SYMBOL_TO_TYPE = {
    "P": chess.PAWN, "N": chess.KNIGHT, "B": chess.BISHOP,
    "R": chess.ROOK, "Q": chess.QUEEN, "K": chess.KING,
}
_TYPE_TO_SYMBOL = {v: k for k, v in _SYMBOL_TO_TYPE.items()}


def class_to_piece(index: int) -> Optional[chess.Piece]:
    label = CLASSES[index]
    if label == "xx":
        return None
    color = chess.WHITE if label[0] == "w" else chess.BLACK
    return chess.Piece(_SYMBOL_TO_TYPE[label[1]], color)


def piece_to_class(piece: Optional[chess.Piece]) -> int:
    if piece is None:
        return CLASSES.index("xx")
    color = "w" if piece.color == chess.WHITE else "b"
    return CLASSES.index(f"{color}{_TYPE_TO_SYMBOL[piece.piece_type]}")


def preprocess(crops: list[np.ndarray]) -> np.ndarray:
    """BGR uint8 crops -> (N,3,32,32) float32 blob matching chess-cv's RGB /255."""
    return cv2.dnn.blobFromImages(
        crops,
        scalefactor=1.0 / 255.0,
        size=(INPUT_SIZE, INPUT_SIZE),
        mean=(0.0, 0.0, 0.0),
        swapRB=True,   # our crops are BGR; chess-cv trained on RGB
        crop=False,
    )


def _postprocess(logits: np.ndarray) -> list[SquareLabel]:
    """(N,13) logits -> N SquareLabels (softmax max = confidence)."""
    shifted = logits - logits.max(axis=1, keepdims=True)
    exp = np.exp(shifted)
    probs = exp / exp.sum(axis=1, keepdims=True)
    out: list[SquareLabel] = []
    for row in probs:
        index = int(row.argmax())
        out.append(SquareLabel(piece=class_to_piece(index), confidence=float(row[index])))
    return out


DEFAULT_MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "pieces.onnx"


class PieceClassifier:
    """Classifies square crops into SquareLabels using an ONNX model via cv2.dnn."""

    def __init__(self, model_path: str | Path = DEFAULT_MODEL_PATH) -> None:
        model_path = Path(model_path)
        if not model_path.exists():
            raise FileNotFoundError(f"piece model not found: {model_path}")
        self._net = cv2.dnn.readNetFromONNX(str(model_path))

    def classify(self, crops: list[SquareImage]) -> list[SquareLabel]:
        if not crops:
            return []
        blob = preprocess([c.image for c in crops])
        self._net.setInput(blob)
        logits = self._net.forward()
        return _postprocess(np.asarray(logits, dtype=np.float32))
