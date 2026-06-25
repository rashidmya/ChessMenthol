from __future__ import annotations

import numpy as np
import pytest

pytestmark = pytest.mark.convert


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
