from __future__ import annotations

import chess
import numpy as np

from chessmenthol.vision.pieces import (
    CLASSES,
    INPUT_SIZE,
    class_to_piece,
    piece_to_class,
    preprocess,
    _postprocess,
)


def test_classes_are_chesscv_order():
    assert CLASSES == [
        "bB", "bK", "bN", "bP", "bQ", "bR",
        "wB", "wK", "wN", "wP", "wQ", "wR", "xx",
    ]
    assert INPUT_SIZE == 32


def test_class_to_piece_mapping():
    assert class_to_piece(CLASSES.index("xx")) is None
    assert class_to_piece(CLASSES.index("wP")) == chess.Piece(chess.PAWN, chess.WHITE)
    assert class_to_piece(CLASSES.index("bK")) == chess.Piece(chess.KING, chess.BLACK)
    assert class_to_piece(CLASSES.index("wN")) == chess.Piece(chess.KNIGHT, chess.WHITE)


def test_piece_class_bijection_roundtrips():
    assert piece_to_class(None) == CLASSES.index("xx")
    for index in range(len(CLASSES)):
        assert piece_to_class(class_to_piece(index)) == index


def test_preprocess_blob_shape_and_dtype():
    crops = [np.zeros((40, 40, 3), dtype=np.uint8) for _ in range(5)]
    blob = preprocess(crops)
    assert blob.shape == (5, 3, INPUT_SIZE, INPUT_SIZE)
    assert blob.dtype == np.float32
    white = preprocess([np.full((32, 32, 3), 255, dtype=np.uint8)])
    assert abs(float(white.max()) - 1.0) < 1e-3


def test_postprocess_picks_argmax_and_softmax_confidence():
    logits = np.full((2, 13), -10.0, dtype=np.float32)
    logits[0, CLASSES.index("wP")] = 10.0
    logits[1, CLASSES.index("xx")] = 10.0
    labels = _postprocess(logits)
    assert labels[0].piece == chess.Piece(chess.PAWN, chess.WHITE)
    assert labels[1].piece is None
    assert 0.0 <= labels[0].confidence <= 1.0
    assert labels[0].confidence > 0.99


import pytest

from chessmenthol.vision.pieces import PieceClassifier
from chessmenthol.vision.types import SquareImage


def test_classifier_missing_model_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        PieceClassifier(model_path=tmp_path / "nope.onnx")


@pytest.mark.convert
def test_classify_runs_through_cv2dnn(tmp_path):
    # build a tiny real ONNX (random weights) matching the I/O contract and
    # confirm classify() returns one well-formed SquareLabel per crop, in order.
    import torch
    import torch.nn as nn

    class Tiny(nn.Module):
        def __init__(self):
            super().__init__()
            self.fc = nn.Linear(3 * INPUT_SIZE * INPUT_SIZE, len(CLASSES))

        def forward(self, x):
            return self.fc(x.flatten(1))

    onnx_path = tmp_path / "tiny.onnx"
    dummy = torch.zeros(1, 3, INPUT_SIZE, INPUT_SIZE)
    torch.onnx.export(
        Tiny(), dummy, str(onnx_path),
        input_names=["input"], output_names=["logits"],
        dynamic_axes={"input": {0: "n"}, "logits": {0: "n"}}, opset_version=12,
    )
    clf = PieceClassifier(model_path=onnx_path)
    crops = [SquareImage(square="a1", image=np.zeros((30, 30, 3), np.uint8)) for _ in range(64)]
    labels = clf.classify(crops)
    assert len(labels) == 64
    for label in labels:
        assert label.piece is None or isinstance(label.piece, chess.Piece)
        assert 0.0 <= label.confidence <= 1.0
    assert clf.classify([]) == []  # empty short-circuit
