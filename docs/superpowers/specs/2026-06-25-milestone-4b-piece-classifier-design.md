# Milestone 4b — Piece Classifier — Design Spec

**Date:** 2026-06-25
**Status:** Approved for planning
**Parent:** [`2026-06-24-chessmenthol-design.md`](2026-06-24-chessmenthol-design.md) §6.3 `piece_classify`, §9 packaging
**Sibling:** [`2026-06-25-milestone-4a-position-assembly-design.md`](2026-06-25-milestone-4a-position-assembly-design.md) (produces the `SquareLabel` consumer)

## 1. Overview

Milestone 4 is split into M4a (position assembly, done), **M4b (this spec — piece classifier)**, and M4c
(live integration). M4b classifies each of the 64 detected square crops as empty or one of the twelve
piece types, with a confidence, producing the `SquareLabel`s that M4a's `assemble` already consumes.

It has two halves:

- **Shipped runtime:** `chessmenthol/vision/pieces.py` — a `PieceClassifier` that loads a bundled ONNX
  model through OpenCV's `cv2.dnn` (no new runtime dependency) and classifies crops.
- **Dev-time training pipeline:** a `training/` package (synthetic data generation → a small CNN
  trained with PyTorch → ONNX export → accuracy evaluation) behind a `[train]` optional-dependency
  group. The only artifact that ships is the trained `pieces.onnx` model.

The two halves share a single **preprocessing contract** and **class↔piece mapping**, both defined in
`pieces.py` and imported by the training code so they can never drift.

## 2. Goals

- Classify 64 `SquareImage` crops → 64 `SquareLabel`s (`chess.Piece | None`, confidence), in input order.
- Run inference with **zero new runtime dependency** via `cv2.dnn` (OpenCV is already bundled).
- Train a **small CNN** on **synthetic data built from real open-license piece sets** composited onto
  varied board themes/sizes with augmentation — the mechanism that generalizes to unseen sites.
- Ship a small (<1 MB) committed `pieces.onnx`, PyInstaller-bundled alongside Stockfish.
- Keep training reproducible and dev-time only (CI does not retrain).

## 3. Non-Goals (this milestone)

- **No live capture loop, no server/WebSocket/frontend wiring** — that is M4c. M4b stops at
  `classify(crops) -> labels`.
- **No position assembly** — M4a owns that; M4b only produces `SquareLabel`s.
- **No `onnxruntime` runtime dependency** — inference is via `cv2.dnn`. (`onnxruntime` has a 3.14 wheel
  but is deliberately not shipped, to keep binaries small.)
- **No redistribution of piece-set image assets** — they are fetched at training time and git-ignored;
  only the trained model (our own artifact) is committed/shipped.
- **No GPU requirement** — the model is tiny; CPU-only PyTorch suffices for training.

## 4. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Python 3.14 deps | Resolved: `onnxruntime` 1.27, `onnx` 1.22, `torch` 2.12 all have cp314 wheels; `cv2.dnn.readNetFromONNX` is present in bundled opencv 4.13. |
| Inference runtime | **`cv2.dnn`** — no new runtime dependency, smaller per-OS binaries. `onnx`/`torch` are dev-time only. |
| Training data realism | **Real open-license piece sets** (pre-rasterized PNGs) composited onto procedural board themes, with augmentation. Best generalization (the spec's primary technical risk). |
| Asset sourcing | `scripts/fetch_piece_sets.py` (mirrors `fetch_engines.py`) fetches sets into a git-ignored dev dir; licenses documented; not redistributed. |
| Model | Small custom CNN, 48×48 RGB input, 13 classes, <1 MB ONNX. |
| Model artifact | The trained `chessmenthol/models/pieces.onnx` is **committed** (small) and PyInstaller-bundled. |
| Held-out split | By **piece-set and theme**, so accuracy measures generalization to unseen styles, not memorization. |
| Milestone shape | One milestone, **inference-contract-first** build order. |

## 5. Module & file layout

```
chessmenthol/vision/pieces.py     # SHIPPED: preprocessing contract, class↔piece map, PieceClassifier
chessmenthol/models/pieces.onnx   # SHIPPED: committed trained model (bundled by PyInstaller)
training/__init__.py              # DEV-TIME (not shipped)
training/dataset.py               #   synthetic crop generator (real pieces × themes × augmentation)
training/model.py                 #   the torch CNN definition
training/train.py                 #   training loop + ONNX export + accuracy report (CLI)
scripts/fetch_piece_sets.py       # DEV-TIME: fetch open-license piece-set PNGs (git-ignored)
tests/vision/test_pieces.py       # inference plumbing + accuracy-gate tests
tests/training/test_dataset.py    # data-generator + ONNX round-trip tests
```

`pieces.py` depends only on `cv2`, `numpy`, `python-chess` (for `chess.Piece`) — all already shipped.
`training/` depends on `torch`/`onnx` (the `[train]` extra) plus `cv2`/`numpy`.

## 6. Preprocessing contract & class map (`pieces.py`, shared)

The single source of truth, imported by both inference and training:

- `INPUT_SIZE = 48` (48×48), `CLASSES` — an ordered list of 13 labels:
  `["empty", "wP","wN","wB","wR","wQ","wK", "bP","bN","bB","bR","bQ","bK"]`.
- `preprocess(crops: list[np.ndarray]) -> np.ndarray` — wraps `cv2.dnn.blobFromImages` with fixed
  params (size 48×48, `scalefactor=1/255`, a fixed `swapRB` choice so the channel order matches
  training, no mean subtraction). Returns an `(N,3,48,48)` float32 blob.
- `class_to_piece(index: int) -> chess.Piece | None` and `piece_to_class(piece|None) -> int` — the
  bijection between the 13 class indices and `chess.Piece | None` (index 0 = `empty` → `None`).

Training imports `INPUT_SIZE`, `CLASSES`, `piece_to_class`, and `preprocess` so the model is trained on
exactly the blob the runtime feeds it.

## 7. Inference module (`pieces.py`, §6.3)

```
class PieceClassifier:
    def __init__(self, model_path: str | Path = <bundled pieces.onnx>): ...
    def classify(self, crops: list[SquareImage]) -> list[SquareLabel]: ...
```

- `__init__` loads the model once: `self._net = cv2.dnn.readNetFromONNX(str(model_path))`.
- `classify`: extract the crop images → `preprocess` → `self._net.setInput(blob)` → `self._net.forward()`
  → softmax per row → `argmax` (class) + max prob (confidence) → `class_to_piece(class)` →
  `SquareLabel(piece, confidence)`, returned **in the same order as the input crops**.
- The bundled model path is resolved relative to the package (PyInstaller-friendly:
  `importlib.resources` / `__file__`-relative), so it works both from source and from a frozen binary.
- `SquareImage` and `SquareLabel` are imported from `chessmenthol.vision.types` and
  `chessmenthol.position` respectively. (`SquareLabel` currently lives in `position.py`; M4b imports it
  there. If that creates an awkward dependency direction, the plan may relocate `SquareLabel` to
  `vision/types.py` — a small, M4a-compatible move — but default to importing from `position`.)

## 8. Training pipeline (`training/`, dev-time)

### 8.1 Assets — `scripts/fetch_piece_sets.py`
Fetches several open-license piece sets (PNG, e.g. Lichess `cburnett`, `merida`, `alpha`, `pirouetti`,
…) into a git-ignored `training/assets/pieces/<set>/<wP|bK|…>.png`, writing a `LICENSES.md` recording
each set's source and license. Mirrors `fetch_engines.py` (fetch-on-demand, not committed). A system/dev
fallback is acceptable; the assets are never shipped.

### 8.2 Data generation — `training/dataset.py`
`generate(out_or_iter, n, *, seed)` produces labeled 48×48 crops: pick a board theme (light/dark BGR),
a square size, a piece set, and a piece class (incl. `empty`); render the square background and
composite the piece PNG (alpha-blended, scaled to ~70–85% of the cell, slight translation/scale jitter);
apply augmentation (Gaussian blur, JPEG re-encode, brightness/contrast jitter, occasional last-move
highlight tint). The label is the chosen class. Deterministic given `seed` (seed a `numpy` Generator
explicitly; no wall-clock randomness). The **held-out split holds out whole piece-sets and themes**, so
test accuracy reflects generalization, not memorization.

### 8.3 Model — `training/model.py`
A small CNN (3 conv-BN-ReLU-maxpool blocks → global average pool → FC → 13 logits). Defined in PyTorch.

### 8.4 Train + export — `training/train.py` (CLI)
Trains on generated crops, evaluates on the held-out split, **exports ONNX** (`torch.onnx.export`,
opset compatible with `cv2.dnn`), verifies the exported model loads in `cv2.dnn` and produces logits
matching PyTorch within tolerance, writes `chessmenthol/models/pieces.onnx`, and prints an accuracy
report (overall + per-class confusion summary). Run manually to (re)produce the shipped model.

## 9. Model artifact & packaging (parent §9)

- `chessmenthol/models/pieces.onnx` is committed (small, <1 MB) and bundled by PyInstaller next to the
  Stockfish binary. No fetch at runtime.
- The `[train]` extra (`torch`, `onnx`) and `training/` package are excluded from the shipped app and
  from PyInstaller bundling. `pieces.py` itself imports only already-shipped libraries.

## 10. Error handling

- **Missing/corrupt model file:** `PieceClassifier.__init__` raises a clear error naming the expected
  path (configuration error, surfaced at startup, not per-frame).
- **Wrong crop count:** `classify` works for any list length (returns one label per crop); callers
  (M4c) are responsible for passing 64. No hard assert on 64 here.
- **Low confidence is data, not an error:** every label carries its confidence; M4a's `assemble`
  flags low-confidence squares for the UI. The classifier never raises on an ambiguous crop.

## 11. Testing strategy (TDD)

- **Plumbing (no trained model):** construct a tiny deterministic ONNX model in-test (or a 1×1-conv
  identity-ish net) and assert: `preprocess` returns an `(N,3,48,48)` float32 blob with the agreed
  scale/order; `classify` returns one `SquareLabel` per crop in input order; `argmax`→`class_to_piece`
  maps correctly (incl. class 0 → empty → `None`); confidence is in `[0,1]`; the `class_to_piece` /
  `piece_to_class` bijection round-trips for all 13 classes.
- **Data generator:** deterministic given a seed; generated crops carry the correct label; held-out
  split shares no piece-set/theme with train.
- **ONNX round-trip:** a freshly-built (untrained) CNN exported to ONNX loads in `cv2.dnn` and produces
  logits matching PyTorch on the same blob within a small tolerance (guards the export/opset/preproc
  contract independent of accuracy). Marked `@pytest.mark.train` (needs torch) and skipped when the
  `[train]` extra is absent.
- **Accuracy gate (uses the shipped `pieces.onnx`):** ≥ ~98% per-square on a held-out synthetic set,
  and correct placement reconstruction on M3's committed real-ish fixtures (per-square ≥ ~95%, with
  remaining misreads flagged low-confidence). Skipped if the model file is absent. Numbers are the gate,
  tuned empirically during training.
- Tests that need `torch` are marked and skipped in a runtime-only environment; the plumbing and the
  accuracy-gate-against-the-committed-model run without torch.

## 12. Build order (de-risk inference contract first)

1. **Inference + contract** (`pieces.py`): preprocessing, class map, `PieceClassifier`, validated with a
   tiny in-test ONNX model. Ships; no torch.
2. **Assets + data generator** (`fetch_piece_sets.py`, `training/dataset.py`): labeled crops + tests.
3. **Model + train/export** (`training/model.py`, `training/train.py`): CNN, training loop, ONNX export,
   round-trip test.
4. **Train the shipped model**: run the pipeline, commit `pieces.onnx`, pass the accuracy gate.

## 13. Dependencies

- **Runtime:** none new — `cv2` (`opencv-python-headless`), `numpy`, `python-chess` already present.
- **Dev-time `[train]` extra:** `torch` (CPU), `onnx`. Plus `scripts/fetch_piece_sets.py` for assets.
- All have Python 3.14 wheels (verified). `pieces.py` stays PyInstaller-clean (no torch import).

## 14. Deliverable / acceptance

- `PieceClassifier().classify(64 crops) -> 64 SquareLabel`s, in input order, each with a confidence,
  feeding directly into M4a's `assemble`.
- A committed `chessmenthol/models/pieces.onnx` (<1 MB) loaded via `cv2.dnn`, meeting the accuracy gate
  on held-out synthetic + M3 real-ish fixtures.
- Reproducible `training/` pipeline behind the `[train]` extra; runtime app gains **no** new dependency.
- No server/frontend/CLI-app changes.

## 15. Risks & open questions

- **Generalization to real sites** (the parent spec's primary risk). Mitigation: real piece sets ×
  many themes/sizes + held-out-by-set/theme evaluation + augmentation + per-square confidence flagging
  (so M4a/M4c can surface misreads for edit-mode correction). Real-screenshot validation deepens in M4c.
- **Piece-set licensing.** We fetch (not redistribute) and document licenses; the shipped artifact is
  our own trained model. Prefer permissively-licensed sets where possible.
- **`cv2.dnn` opset/op support.** A deliberately small CNN uses only conv/BN/ReLU/pool/GEMM/softmax —
  all well-supported by `cv2.dnn`; the ONNX round-trip test guards this explicitly.
- **Accuracy-gate numbers** are initial targets; they will be tuned against real data, and the model can
  be retrained without code changes.
- **`torch` install weight** (pulls a large CUDA stack by default). The plan should install **CPU-only**
  torch for the `[train]` extra to keep the dev environment lean.
