# Milestone 4b — Piece Classifier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `PieceClassifier` that classifies the 64 detected square crops into `SquareLabel`s via OpenCV's `cv2.dnn`, backed by a `pieces.onnx` model **converted from the MIT-licensed `chess-cv` pretrained weights** (no from-scratch training).

**Architecture:** A small shipped module (`chessmenthol/vision/pieces.py`) does preprocessing + `cv2.dnn` inference + label mapping — no new runtime dependency. A dev-time script (`scripts/convert_pieces_model.py`, behind a `[convert]` extra) downloads chess-cv's `pieces.safetensors`, rebuilds its tiny CNN in PyTorch, loads the weights (with the MLX→PyTorch layout fixes), exports ONNX, and is validated by reproducing chess-cv's ~98% accuracy on its `chess-cv-openboard` real dataset.

**Tech Stack:** Runtime — `cv2.dnn` (opencv-python-headless, already shipped), `numpy`, `python-chess`. Dev-time `[convert]` extra — `torch` (CPU), `safetensors`, `huggingface_hub`, `datasets`, `onnx`.

**Reference spec:** `docs/superpowers/specs/2026-06-25-milestone-4b-piece-classifier-design.md`

**Conventions:** Every Python file starts with `from __future__ import annotations`. Run tests with `.venv/bin/pytest`. Tests needing torch/HF/network are marked `@pytest.mark.convert` and skip without the extra.

**chess-cv facts (already researched — do not re-derive):**
- Repo `S1M0N38/chess-cv` (MIT). Pieces model: `SimpleCNN`, **32×32 RGB** input.
- Architecture: `conv1` 3→16 (3×3, pad 1), `conv2` 16→32 (3×3, pad 1), `conv3` 64 out (3×3, pad 1); `MaxPool2d(2,2)` after each conv; ReLU; **no BatchNorm**; flatten → `fc1` 1024→128, `Dropout(0.5)`, `fc2` 128→13. ~156k params.
- **Class order (index 0..12):** `["bB","bK","bN","bP","bQ","bR","wB","wK","wN","wP","wQ","wR","xx"]` (alphabetical; `xx` = empty).
- **Inference preprocessing:** PIL RGB → `np.float32 / 255.0`. No mean/std.
- **Weights:** `hf_hub_download("S1M0N38/chess-cv", "pieces.safetensors")`. MLX layout: conv weight is `(out, kH, kW, in)` (channels-last); Linear weight is `(out, in)` (same as torch). MLX is channels-last throughout, so `fc1` expects an **`(H,W,C)`-ordered** flatten.
- **Eval dataset:** `S1M0N38/chess-cv-openboard` (labeled real screenshots), chess-cv reports F1 ≈ 98.6%.

---

## File Structure

| File | Responsibility |
|---|---|
| `pyproject.toml` | **Modify** — add `[convert]` optional-deps + `convert` pytest marker |
| `chessmenthol/vision/pieces.py` | **Create** — `INPUT_SIZE`, `CLASSES`, `class_to_piece`/`piece_to_class`, `preprocess`, `_postprocess`, `PieceClassifier` |
| `chessmenthol/models/pieces.onnx` | **Create (committed)** — converted model, bundled |
| `chessmenthol/models/NOTICE.md` | **Create** — MIT attribution/provenance for chess-cv |
| `scripts/convert_pieces_model.py` | **Create** — dev-time conversion (safetensors→torch→ONNX) |
| `tests/vision/test_pieces.py` | **Create** — pure-logic + committed-model runtime tests |
| `tests/conversion/test_convert.py` | **Create** — `convert`-marked round-trip + openboard-accuracy tests |
| `tests/vision/fixtures/pieces/<label>/*.png` | **Create (committed)** — a few real labeled crops for a CI correctness check |

---

## Task 1: Dependencies, marker, and models scaffold

**Files:**
- Modify: `pyproject.toml`
- Create: `chessmenthol/models/NOTICE.md`

- [ ] **Step 1: Add the `[convert]` extra and the `convert` marker**

In `pyproject.toml`, under `[project.optional-dependencies]`, add:

```toml
convert = ["torch", "safetensors", "huggingface_hub", "datasets", "onnx"]
```

And under `[tool.pytest.ini_options]`, extend `markers` to include:

```toml
    "convert: requires the [convert] extra (torch/onnx/huggingface) and network access",
```

- [ ] **Step 2: Create the attribution notice**

Create `chessmenthol/models/NOTICE.md`:

```markdown
# Bundled model attribution

`pieces.onnx` is derived by format-converting the pretrained **pieces** weights of
**chess-cv** (https://github.com/S1M0N38/chess-cv, https://huggingface.co/S1M0N38/chess-cv),
© S1M0N38, released under the MIT License. Only the model weights were reused; they were
converted from MLX/SafeTensors to ONNX for inference via OpenCV's `cv2.dnn`. No chess-cv
source code is redistributed. See the upstream repository for the full MIT license text.
```

- [ ] **Step 3: Verify pyproject parses**

Run: `.venv/bin/python -c "import tomllib; tomllib.load(open('pyproject.toml','rb')); print('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml chessmenthol/models/NOTICE.md
git commit -m "chore(pieces): add [convert] extra, convert marker, and model attribution"
```

---

## Task 2: Inference contract — labels, mapping, preprocessing, postprocessing

This is pure logic with **no torch and no model file** — fully unit-testable at runtime.

**Files:**
- Create: `chessmenthol/vision/pieces.py`
- Test: `tests/vision/test_pieces.py`

- [ ] **Step 1: Write the failing test**

Create `tests/vision/test_pieces.py`:

```python
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
    # scalefactor 1/255 on an all-255 image -> ~1.0
    white = preprocess([np.full((32, 32, 3), 255, dtype=np.uint8)])
    assert abs(float(white.max()) - 1.0) < 1e-3


def test_postprocess_picks_argmax_and_softmax_confidence():
    # two crops: row0 strongly "wP", row1 strongly "xx"
    logits = np.full((2, 13), -10.0, dtype=np.float32)
    logits[0, CLASSES.index("wP")] = 10.0
    logits[1, CLASSES.index("xx")] = 10.0
    labels = _postprocess(logits)
    assert labels[0].piece == chess.Piece(chess.PAWN, chess.WHITE)
    assert labels[1].piece is None
    assert 0.0 <= labels[0].confidence <= 1.0
    assert labels[0].confidence > 0.99
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/vision/test_pieces.py -v`
Expected: FAIL — `ModuleNotFoundError: chessmenthol.vision.pieces`.

- [ ] **Step 3: Implement the contract**

Create `chessmenthol/vision/pieces.py`:

```python
from __future__ import annotations

from typing import Optional

import chess
import cv2
import numpy as np

from chessmenthol.position import SquareLabel

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
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/vision/test_pieces.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/vision/pieces.py tests/vision/test_pieces.py
git commit -m "feat(pieces): add label map, preprocessing, and postprocessing contract"
```

---

## Task 3: `PieceClassifier` (cv2.dnn loading + classify)

**Files:**
- Modify: `chessmenthol/vision/pieces.py`
- Test: `tests/vision/test_pieces.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/vision/test_pieces.py`:

```python
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
```

The `@pytest.mark.convert` test needs the `[convert]` extra (torch); it is skipped otherwise. The missing-model test runs at runtime with no extra.

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/vision/test_pieces.py -k "missing_model" -v`
Expected: FAIL — `ImportError: cannot import name 'PieceClassifier'`.

- [ ] **Step 3: Implement `PieceClassifier`**

Add to `chessmenthol/vision/pieces.py` (add `from pathlib import Path` and `import os`-free path handling at the top imports):

```python
from pathlib import Path

from chessmenthol.vision.types import SquareImage

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
```

(Place the `from pathlib import Path` / `from chessmenthol.vision.types import SquareImage` imports with the other imports at the top; the `DEFAULT_MODEL_PATH` and `PieceClassifier` definitions go after `_postprocess`.)

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/vision/test_pieces.py -v`
Expected: the runtime tests PASS; the `@pytest.mark.convert` test passes if the `[convert]` extra is installed, otherwise it is skipped. If torch is not installed, run `.venv/bin/pytest tests/vision/test_pieces.py -v -m "not convert"` and expect all PASS.

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/vision/pieces.py tests/vision/test_pieces.py
git commit -m "feat(pieces): add PieceClassifier cv2.dnn inference wrapper"
```

---

## Task 4: Conversion script — chess-cv SafeTensors → PyTorch → ONNX

**Install the extra first (CPU torch to stay light):**
`.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu` then
`.venv/bin/pip install safetensors huggingface_hub datasets onnx`

**Files:**
- Create: `scripts/convert_pieces_model.py`
- Test: `tests/conversion/test_convert.py` (and `tests/conversion/__init__.py`)

- [ ] **Step 1: Write the failing round-trip test**

Create `tests/conversion/__init__.py` (empty) and `tests/conversion/test_convert.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/conversion/test_convert.py -v`
Expected: FAIL — `ModuleNotFoundError: scripts.convert_pieces_model` (or skipped if `[convert]` absent — install it first per the step above).

- [ ] **Step 3: Implement the conversion script**

Create `scripts/convert_pieces_model.py`:

```python
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
        x = x.permute(0, 2, 3, 1).reshape(x.shape[0], -1)  # -> (N, H,W,C) flatten
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
```

**Important for the implementer:** before trusting the key names in `load_weights_into`, run
`.venv/bin/python scripts/convert_pieces_model.py --print-keys` and confirm the actual SafeTensors keys
and shapes. chess-cv attribute names are `conv1/conv2/conv3/fc1/fc2`; if the export nests them (e.g.
`layers.0.weight`), adjust the mapping accordingly. The shape-based `if` guards auto-handle the
transpose direction, but the **names** must match.

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/conversion/test_convert.py -v`
Expected: PASS (the round-trip test builds a random-weight `SimpleCNN`, exports, and confirms cv2.dnn ≈ torch). If `cv2.dnn` rejects an op, reduce `opset_version` (try 11) or simplify the export; the architecture here uses only conv/relu/maxpool/gemm which cv2.dnn supports.

- [ ] **Step 5: Commit**

```bash
git add scripts/convert_pieces_model.py tests/conversion/__init__.py tests/conversion/test_convert.py
git commit -m "feat(pieces): add chess-cv -> ONNX conversion script with round-trip test"
```

---

## Task 5: Convert the real model, gate accuracy, commit the artifact

This task downloads chess-cv's real weights + the openboard dataset, so it needs the `[convert]` extra
and network access. It produces the committed `pieces.onnx` and a small committed real-crop fixture set.

**Files:**
- Create (committed): `chessmenthol/models/pieces.onnx`
- Create (committed): `tests/vision/fixtures/pieces/<label>/*.png` (a few real labeled crops)
- Modify: `tests/conversion/test_convert.py` (accuracy gate)
- Modify: `tests/vision/test_pieces.py` (committed-model runtime sanity)

- [ ] **Step 1: Convert the real weights**

Run: `.venv/bin/python scripts/convert_pieces_model.py --print-keys` and confirm the key names/shapes,
adapting `load_weights_into` if needed. Then:
Run: `.venv/bin/python scripts/convert_pieces_model.py -o chessmenthol/models/pieces.onnx`
Expected: prints `wrote chessmenthol/models/pieces.onnx`; the file is < ~1 MB.

- [ ] **Step 2: Write the openboard accuracy gate**

Append to `tests/conversion/test_convert.py`:

```python
def test_converted_model_accuracy_on_openboard():
    """The committed pieces.onnx must reproduce chess-cv's real-data accuracy,
    which only passes if the architecture, weight layout, class order, and
    preprocessing are all correct."""
    import cv2
    from datasets import load_dataset

    from chessmenthol.vision.pieces import CLASSES, preprocess

    model_path = "chessmenthol/models/pieces.onnx"
    net = cv2.dnn.readNetFromONNX(model_path)
    ds = load_dataset("S1M0N38/chess-cv-openboard", split="test")

    # The implementer confirms the dataset's image + label column names via
    # `ds.features`; map each string label to its CLASSES index. Images are RGB
    # PIL; convert to BGR uint8 so preprocess()'s swapRB yields RGB again.
    correct = total = 0
    for batch_start in range(0, len(ds), 256):
        rows = ds[batch_start : batch_start + 256]
        images = [cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR) for im in rows["image"]]
        blob = preprocess(images)
        net.setInput(blob)
        preds = net.forward().argmax(axis=1)
        for pred, label in zip(preds, rows["label"]):
            total += 1
            correct += int(CLASSES[int(pred)] == _openboard_label_to_class(label))
    accuracy = correct / total
    assert accuracy >= 0.95, f"openboard accuracy {accuracy:.4f} below gate"
```

Add a small helper `_openboard_label_to_class(label)` at the top of the file that maps the dataset's
label representation (int class-id or string) to one of `CLASSES` — the implementer fills this in after
inspecting `ds.features["label"]` (e.g. if it's a `ClassLabel`, use `ds.features["label"].int2str`).
**Do not weaken the 0.95 gate**; if it fails, the conversion is wrong (revisit `load_weights_into`, the
NHWC flatten, the class order, or preprocessing) — that is the whole point of this test.

- [ ] **Step 3: Build the committed real-crop fixtures + a runtime correctness test**

From the openboard dataset, save **two correctly-labeled real crops per class** (26 small PNGs) to
`tests/vision/fixtures/pieces/<CLASSES-label>/<n>.png` (a one-off snippet using `datasets` + PIL; the
crops are committed, the snippet is not). Then append to `tests/vision/test_pieces.py` a **runtime**
(no-torch) correctness test:

```python
import pathlib

import cv2

_PIECE_FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "pieces"


@pytest.mark.skipif(
    not (chessmenthol_models_present := (pathlib.Path("chessmenthol/models/pieces.onnx").exists())),
    reason="committed pieces.onnx not present",
)
def test_committed_model_classifies_real_crops():
    clf = PieceClassifier()
    paths = sorted(_PIECE_FIXTURES.glob("*/*.png"))
    assert paths, "no committed piece fixtures"
    crops, expected = [], []
    for p in paths:
        crops.append(SquareImage(square="a1", image=cv2.imread(str(p))))
        expected.append(p.parent.name)  # the CLASSES label
    labels = clf.classify(crops)
    from chessmenthol.vision.pieces import piece_to_class, CLASSES
    correct = sum(
        CLASSES[piece_to_class(lab.piece)] == exp for lab, exp in zip(labels, expected)
    )
    assert correct / len(paths) >= 0.90
```

(Simplify the `skipif` to a plain `pathlib.Path(...).exists()` call if the walrus reads awkwardly.)

- [ ] **Step 4: Run the gates**

Run: `.venv/bin/pytest tests/conversion/test_convert.py -v` (needs `[convert]` + network) → accuracy ≥ 0.95.
Run: `.venv/bin/pytest tests/vision/test_pieces.py -v -m "not convert"` → committed-model correctness ≥ 0.90, runtime-only.

- [ ] **Step 5: Commit the model + fixtures + tests**

```bash
git add chessmenthol/models/pieces.onnx tests/vision/fixtures/pieces tests/conversion/test_convert.py tests/vision/test_pieces.py
git commit -m "feat(pieces): convert+commit chess-cv ONNX model, gate accuracy on real crops"
```

---

## Task 6: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Runtime suite (no torch) is green**

Run: `.venv/bin/pytest -q -m "not convert"`
Expected: all runtime tests pass (the prior 162 + the new pieces runtime tests), including the
committed-model correctness test. `convert`-marked tests are deselected.

- [ ] **Step 2: `pieces.py` stays runtime-clean (no torch import)**

Run: `.venv/bin/python -c "import chessmenthol.vision.pieces, sys; assert 'torch' not in sys.modules; print('pieces import is torch-free')"`
Expected: prints `pieces import is torch-free` (proves the shipped module never pulls a dev-time dep).

- [ ] **Step 3: The classifier feeds M4a end-to-end**

Run:
```
.venv/bin/python -c "
import numpy as np, chess
from chessmenthol.vision.pieces import PieceClassifier
from chessmenthol.vision.types import SquareImage
from chessmenthol.position import assemble
import pathlib
crops = [SquareImage('a1', __import__('cv2').imread(str(p))) for p in sorted(pathlib.Path('tests/vision/fixtures/pieces').glob('*/*.png'))[:64]]
labels = PieceClassifier().classify(crops)
print('classified', len(labels), 'crops ->', type(labels[0]).__name__)
"
```
Expected: prints that crops were classified into `SquareLabel`s (the same type `assemble` consumes),
confirming the M4b→M4a contract.

- [ ] **Step 4: Confirm scope — no server/frontend drift**

Run: `git diff --stat main -- chessmenthol/server frontend chessmenthol/cli.py`
Expected: empty output.

- [ ] **Step 5: Final commit (only if anything was adjusted)**

```bash
git add -A
git commit -m "test(pieces): milestone 4b full-suite verification" || echo "nothing to commit"
```

---

## Self-Review Notes (author)

- **Spec coverage:** inference contract+classifier (§6,§7 → Tasks 2,3), conversion (§8 → Tasks 4,5),
  model artifact+attribution+bundling (§9 → Tasks 1,5), error handling (§10 → Task 3 missing-model +
  classify guard), testing incl. plumbing/round-trip/accuracy-gate/committed-sanity (§11 → Tasks 2–5),
  build order (§12 → task order), deps (§13 → Task 1), deliverable (§14 → Task 6). All sections mapped.
- **Known inspect-and-adapt points (inherent to a conversion):** the SafeTensors key names
  (`--print-keys` step), the openboard dataset's label column representation
  (`_openboard_label_to_class`), and the real-crop fixture extraction are explicitly called out with
  concrete commands; the accuracy gate is the decisive correctness check, so a wrong guess fails loudly
  rather than silently.
- **Type consistency:** `SquareLabel` (from `chessmenthol.position`) and `SquareImage` (from
  `chessmenthol.vision.types`) are used consistently; `CLASSES`/`INPUT_SIZE`/`class_to_piece`/
  `piece_to_class`/`preprocess`/`_postprocess`/`PieceClassifier.classify` signatures match across Tasks
  2–6. The torch `SimpleCNN`'s channels-last flatten is the one subtle correctness point and is
  documented in the code.
- **Runtime/dev-time split:** `pieces.py` imports only `cv2`/`numpy`/`chess` (verified in Task 6);
  `torch`/`safetensors`/`hf`/`onnx` live behind `[convert]` and `@pytest.mark.convert`.
