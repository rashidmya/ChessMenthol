from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

REPO_ID = "S1M0N38/chess-cv"
WEIGHTS_FILE = "pieces.safetensors"
INPUT_SIZE = 32
DEFAULT_OUT = Path("chessmenthol/models/pieces.onnx")


class SimpleCNN(nn.Module):
    """PyTorch replica of chess-cv's MLX SimpleCNN. The forward flattens in
    channels-LAST (H,W,C) order to match MLX, so the pretrained fc1 weights
    load directly."""

    def __init__(self, num_classes: int = 13) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(3, 16, 3, padding=1)
        self.conv2 = nn.Conv2d(16, 32, 3, padding=1)
        self.conv3 = nn.Conv2d(32, 64, 3, padding=1)
        self.pool = nn.MaxPool2d(2, 2)
        self.fc1 = nn.Linear(1024, 128)
        self.dropout = nn.Dropout(0.5)
        self.fc2 = nn.Linear(128, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # x: (N,3,32,32)
        x = self.pool(F.relu(self.conv1(x)))
        x = self.pool(F.relu(self.conv2(x)))
        x = self.pool(F.relu(self.conv3(x)))            # (N,64,4,4)
        x = torch.flatten(x.permute(0, 2, 3, 1), 1)  # -> (N, H,W,C) channels-last flatten
        x = F.relu(self.fc1(x))
        x = self.dropout(x)
        x = self.fc2(x)
        return x


def load_weights_into(model: SimpleCNN, weights: dict[str, np.ndarray]) -> None:
    """Map chess-cv/MLX tensors into the torch model. MLX is channels-last, so
    conv weights are (out,kH,kW,in) and ALWAYS transpose to torch (out,in,kH,kW).
    Linear weights are (out,in); a shape check handles a possible (in,out) store.
    Inspect `weights.keys()` first (via --print-keys) if the names differ."""
    state = {}
    for name in ("conv1", "conv2", "conv3"):
        w = np.transpose(weights[f"{name}.weight"], (0, 3, 1, 2))  # OHWI -> OIHW
        layer = getattr(model, name)
        expected = (layer.out_channels, layer.in_channels, *layer.kernel_size)
        assert w.shape == expected, f"{name}: got {w.shape}, expected {expected}"
        state[f"{name}.weight"] = torch.from_numpy(np.ascontiguousarray(w))
        state[f"{name}.bias"] = torch.from_numpy(np.ascontiguousarray(weights[f"{name}.bias"]))
    for name in ("fc1", "fc2"):
        lw = weights[f"{name}.weight"]
        layer = getattr(model, name)
        if lw.shape == (layer.in_features, layer.out_features):  # stored (in,out)
            lw = lw.T
        assert lw.shape == (layer.out_features, layer.in_features), \
            f"{name}: got {lw.shape}"
        state[f"{name}.weight"] = torch.from_numpy(np.ascontiguousarray(lw))
        state[f"{name}.bias"] = torch.from_numpy(np.ascontiguousarray(weights[f"{name}.bias"]))
    model.load_state_dict(state)


def export_onnx(model: SimpleCNN, out_path: Path) -> None:
    model.eval()
    dummy = torch.zeros(1, 3, INPUT_SIZE, INPUT_SIZE)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model, dummy, str(out_path),
        input_names=["input"], output_names=["logits"],
        dynamic_axes={"input": {0: "n"}, "logits": {0: "n"}},
        opset_version=12,
        dynamo=False,  # use the classic exporter (cv2.dnn-friendly, no onnxscript dep)
    )


def fetch_weights() -> dict[str, np.ndarray]:
    from huggingface_hub import hf_hub_download
    from safetensors.numpy import load_file

    path = hf_hub_download(repo_id=REPO_ID, filename=WEIGHTS_FILE)
    return load_file(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="convert_pieces_model")
    parser.add_argument("-o", "--out", default=str(DEFAULT_OUT))
    parser.add_argument("--print-keys", action="store_true",
                        help="print SafeTensors keys/shapes and exit")
    args = parser.parse_args(argv)

    weights = fetch_weights()
    if args.print_keys:
        for k, v in weights.items():
            print(k, v.shape)
        return 0

    model = SimpleCNN(num_classes=13)
    load_weights_into(model, weights)
    export_onnx(model, Path(args.out))
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
