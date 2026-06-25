from __future__ import annotations

import numpy as np
import pytest

pytestmark = pytest.mark.convert

# chess-cv-openboard exposes a single "train" split whose `label` column is a
# datasets.ClassLabel int over names identical to CLASSES; int2str -> the string.
_OPENBOARD_SPLIT = "train"


def _make_openboard_label_to_class(ds):
    feature = ds.features["label"]
    if hasattr(feature, "int2str"):  # ClassLabel: map int -> CLASSES string
        return lambda label: feature.int2str(int(label))
    return lambda label: label  # already a string


def test_torch_replica_matches_cv2dnn_after_export(tmp_path):
    """A freshly-built (random-weight) SimpleCNN exported to ONNX must produce
    logits matching PyTorch within tolerance when run through cv2.dnn — this
    guards the architecture/export/preprocessing contract independent of the
    real weights."""
    import cv2
    import torch

    from scripts.convert_pieces_model import SimpleCNN, export_onnx
    from chessmenthol.vision.pieces import INPUT_SIZE

    torch.manual_seed(0)
    model = SimpleCNN(num_classes=13).eval()
    onnx_path = tmp_path / "rand.onnx"
    export_onnx(model, onnx_path)

    x = np.random.default_rng(0).random((4, 3, INPUT_SIZE, INPUT_SIZE), dtype=np.float32)
    with torch.no_grad():
        torch_logits = model(torch.from_numpy(x)).numpy()

    net = cv2.dnn.readNetFromONNX(str(onnx_path))
    net.setInput(x)
    cv2_logits = net.forward()

    assert cv2_logits.shape == torch_logits.shape == (4, 13)
    assert np.allclose(cv2_logits, torch_logits, atol=1e-4)


def test_converted_model_accuracy_on_openboard():
    """The committed pieces.onnx must reproduce chess-cv's real-data accuracy,
    which only passes if architecture, weight layout, class order, and
    preprocessing are all correct."""
    import cv2
    from datasets import load_dataset

    from chessmenthol.vision.pieces import CLASSES, preprocess

    net = cv2.dnn.readNetFromONNX("chessmenthol/models/pieces.onnx")
    ds = load_dataset("S1M0N38/chess-cv-openboard", split=_OPENBOARD_SPLIT)
    openboard_label_to_class = _make_openboard_label_to_class(ds)

    correct = total = 0
    for start in range(0, len(ds), 256):
        rows = ds[start : start + 256]
        images = [cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR) for im in rows["image"]]
        blob = preprocess(images)
        net.setInput(blob)
        preds = net.forward().argmax(axis=1)
        for pred, label in zip(preds, rows["label"]):
            total += 1
            correct += int(CLASSES[int(pred)] == openboard_label_to_class(label))
    accuracy = correct / total
    assert accuracy >= 0.95, f"openboard accuracy {accuracy:.4f} below gate"
