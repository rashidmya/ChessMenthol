# Milestone 4b — Piece Classifier — Design Spec

**Date:** 2026-06-25
**Status:** Approved for planning
**Parent:** [`2026-06-24-chessmenthol-design.md`](2026-06-24-chessmenthol-design.md) §6.3 `piece_classify`, §9 packaging
**Sibling:** [`2026-06-25-milestone-4a-position-assembly-design.md`](2026-06-25-milestone-4a-position-assembly-design.md) (produces the `SquareLabel` consumer)

## 1. Overview

Milestone 4 is split into M4a (position assembly, done), **M4b (this spec — piece classifier)**, and M4c
(live integration). M4b classifies each of the 64 detected square crops as empty or one of the twelve
piece types, with a confidence, producing the `SquareLabel`s that M4a's `assemble` already consumes.

**Build-vs-reuse decision:** rather than train a classifier from scratch, M4b **reuses an existing,
MIT-licensed, closely-matched model** — `chess-cv` (`S1M0N38/chess-cv`), a small CNN that classifies
32×32 per-square crops into 13 classes, trained on 55 chess.com/lichess board styles and reporting
~99.9% synthetic / ~98.6% real-screenshot F1. Its weights are published (SafeTensors) but in **MLX**
(Apple) format, so M4b's dev-time work is a **conversion**: replicate the tiny architecture in PyTorch,
load the published weights, export to **ONNX**, and validate it via OpenCV's `cv2.dnn`. The shipped app
gains no new dependency (inference is `cv2.dnn`, already bundled).

This replaces the previously-considered from-scratch training pipeline (no synthetic-data generation, no
piece-set fetching, no training loop). The deliverable is a committed `pieces.onnx` plus the
`PieceClassifier` inference module.

## 2. Goals

- Classify 64 `SquareImage` crops → 64 `SquareLabel`s (`chess.Piece | None`, confidence), in input order.
- Run inference with **zero new runtime dependency** via `cv2.dnn` (OpenCV already bundled).
- Obtain the model by **converting chess-cv's MIT-licensed pretrained pieces weights to ONNX** (dev-time).
- Validate the converted model reproduces chess-cv's reported accuracy on its **open real-screenshot
  dataset** (`chess-cv-openboard`), guarding the architecture/weight-layout/class-order conversion.
- Ship a small (<1 MB) committed `pieces.onnx`, PyInstaller-bundled alongside Stockfish, with MIT
  attribution recorded.

## 3. Non-Goals (this milestone)

- **No live capture loop, no server/WebSocket/frontend wiring** — that is M4c. M4b stops at
  `classify(crops) -> labels`.
- **No position assembly** — M4a owns that; M4b only produces `SquareLabel`s.
- **No `onnxruntime` runtime dependency** — inference is via `cv2.dnn`.
- **No from-scratch training, no synthetic-data generator, no piece-set fetching, no training loop** —
  the model is obtained by conversion. (A future milestone may add a retrain/fine-tune path if real-site
  accuracy needs improvement; explicitly out of scope here.)
- **No dependency on MLX at runtime or in CI** — MLX is Apple-silicon only; we never run it on Linux/CI.
  Conversion uses the framework-agnostic SafeTensors weights directly.

## 4. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Build vs reuse | **Reuse** `chess-cv` (MIT) and convert its pretrained pieces weights to ONNX. |
| Inference runtime | **`cv2.dnn`** — no new runtime dependency, smaller per-OS binaries. |
| Model source | `S1M0N38/chess-cv`, file `pieces.safetensors` (Hugging Face Hub), MIT license. |
| Model shape | chess-cv's `SimpleCNN`, **32×32 RGB** input, **13 classes** (`wP wN wB wR wQ wK`, `bP bN bB bR bQ bK`, `xx`=empty). ~156k params → <1 MB ONNX. |
| Conversion path | SafeTensors weights → replicate arch in PyTorch (handle MLX conv weight layout) → `torch.onnx.export` → validate via `cv2.dnn`. |
| Correctness gate | Match chess-cv's reported accuracy (~98% F1) on `S1M0N38/chess-cv-openboard` (a labeled real dataset). MLX-vs-ONNX exact-output comparison is impossible on Linux, so accuracy-on-real-data is the gate. |
| Model artifact | Converted `chessmenthol/models/pieces.onnx` is **committed** and PyInstaller-bundled; MIT attribution recorded. |
| Milestone shape | One milestone, **inference-contract-first** build order. |

## 5. Module & file layout

```
chessmenthol/vision/pieces.py     # SHIPPED: preprocessing contract, class<->piece map, PieceClassifier
chessmenthol/models/pieces.onnx   # SHIPPED: committed converted model (bundled by PyInstaller)
chessmenthol/models/NOTICE.md     # SHIPPED: MIT attribution + provenance for chess-cv
scripts/convert_pieces_model.py   # DEV-TIME: fetch chess-cv weights, replicate arch, export ONNX, validate
tests/vision/test_pieces.py       # inference plumbing + accuracy-gate tests
tests/conversion/test_convert.py  # conversion + ONNX-round-trip + openboard-accuracy tests (marked, dev-time)
```

`pieces.py` depends only on `cv2`, `numpy`, `python-chess` (`chess.Piece`) — all already shipped.
The conversion script depends on the dev-time `[convert]` extra (`torch`, `safetensors`,
`huggingface_hub`, `onnx`); none of it is imported by the shipped app.

## 6. Preprocessing contract & class map (`pieces.py`, shared)

The single source of truth, used by inference and verified by conversion:

- `INPUT_SIZE = 32` (32×32), `CLASSES` — the ordered 13-label list **in chess-cv's exact output order**
  (determined by reading chess-cv's labels/source during conversion; a wrong order is caught by the
  accuracy gate). Index of `"xx"` maps to empty.
- `preprocess(crops: list[np.ndarray]) -> np.ndarray` — wraps `cv2.dnn.blobFromImages` with params that
  **exactly match chess-cv's inference preprocessing** (32×32, RGB channel order, and chess-cv's
  scaling/normalization, read from its source). Returns an `(N,3,32,32)` float32 blob.
- `class_to_piece(index) -> chess.Piece | None` and `piece_to_class(piece|None) -> int` — the bijection
  between the 13 class indices and `chess.Piece | None` (the `"xx"` index → `None`).

The exact preprocessing constants and class order are **pinned from chess-cv** (not invented), because
the converted weights were trained against them; the ONNX-round-trip and openboard-accuracy tests fail
loudly if they don't match.

## 7. Inference module (`pieces.py`, §6.3)

```
class PieceClassifier:
    def __init__(self, model_path: str | Path = <bundled pieces.onnx>): ...
    def classify(self, crops: list[SquareImage]) -> list[SquareLabel]: ...
```

- `__init__` loads the model once: `cv2.dnn.readNetFromONNX(str(model_path))`.
- `classify`: crop images → `preprocess` → `net.setInput(blob)` → `net.forward()` → per-row softmax →
  `argmax` (class) + max prob (confidence) → `class_to_piece(class)` → `SquareLabel(piece, confidence)`,
  returned **in input-crop order**.
- The bundled model path resolves relative to the package (`importlib.resources`/`__file__`-relative) so
  it works from source and from a frozen PyInstaller binary.
- `SquareImage` from `chessmenthol.vision.types`; `SquareLabel` from `chessmenthol.position`. (If the
  dependency direction feels awkward, the plan may relocate `SquareLabel` into `vision/types.py` — a
  small, M4a-compatible move — but default to importing from `position`.)

## 8. Conversion pipeline (`scripts/convert_pieces_model.py`, dev-time)

A reproducible CLI that produces the shipped ONNX:

1. **Fetch weights:** `huggingface_hub.hf_hub_download("S1M0N38/chess-cv", "pieces.safetensors")`; load
   tensors with `safetensors` (framework-agnostic — no MLX needed).
2. **Replicate the architecture in PyTorch:** read chess-cv's `src/chess_cv/model.py` (`SimpleCNN`) and
   build a matching `torch.nn.Module` (same conv channels/kernels/padding, BN, pooling, FC, activations).
3. **Load weights with layout fixes:** map each chess-cv/MLX tensor to the torch parameter, transposing
   conv weights for MLX's layout (MLX stores conv weights `(out, kH, kW, in)`; PyTorch expects
   `(out, in, kH, kW)`) and handling any BN/linear naming differences. Determine the exact label order.
4. **Export ONNX:** `torch.onnx.export` at an opset `cv2.dnn` supports, dynamic batch dimension.
5. **Validate (the correctness gate):** load the ONNX in `cv2.dnn`; run it (through `pieces.py`'s
   `preprocess`) over the labeled `S1M0N38/chess-cv-openboard` dataset; assert overall accuracy/F1 is
   within a small margin of chess-cv's published ~98.6%. A botched arch/transpose/class-order produces
   near-random accuracy, so this gate is decisive.
6. **Write** `chessmenthol/models/pieces.onnx` and the `NOTICE.md` attribution.

The script is run manually to (re)produce the model; CI does not run it (it needs the `[convert]` extra
and network access to HF).

## 9. Model artifact & packaging (parent §9)

- `chessmenthol/models/pieces.onnx` is committed (<1 MB) and PyInstaller-bundled next to Stockfish; no
  runtime fetch.
- `chessmenthol/models/NOTICE.md` records the MIT license and provenance (chess-cv, the HF repo, commit).
- The `[convert]` extra (`torch`, `safetensors`, `huggingface_hub`, `onnx`) and the conversion script are
  excluded from the shipped app and PyInstaller bundling. `pieces.py` imports only shipped libs.

## 10. Error handling

- **Missing/corrupt model file:** `PieceClassifier.__init__` raises a clear error naming the expected
  path (a startup configuration error, not per-frame).
- **Wrong crop count:** `classify` returns one label per crop for any list length; callers (M4c) pass 64.
- **Low confidence is data, not an error:** every label carries its confidence; M4a's `assemble` flags
  low-confidence squares for the UI. The classifier never raises on an ambiguous crop.

## 11. Testing strategy (TDD)

- **Plumbing (no real model, no torch):** build a tiny deterministic ONNX model in-test and assert:
  `preprocess` returns an `(N,3,32,32)` float32 blob with the agreed size/scale/order; `classify`
  returns one `SquareLabel` per crop in input order; `argmax`→`class_to_piece` maps correctly (the
  `"xx"` index → `None`); confidence ∈ `[0,1]`; the `class_to_piece`/`piece_to_class` bijection
  round-trips for all 13 classes.
- **Conversion round-trip (`@pytest.mark.convert`, dev-time):** after building the torch replica and
  loading weights, export to ONNX, load via `cv2.dnn`, and assert PyTorch and `cv2.dnn` produce matching
  logits within tolerance on the same blob (guards export/opset/preprocessing independent of accuracy).
- **Accuracy gate (`@pytest.mark.convert`, dev-time):** the converted ONNX scores within a small margin
  of chess-cv's ~98.6% on the `chess-cv-openboard` dataset (decisive correctness check for the full
  conversion). Skipped without the `[convert]` extra / network.
- **Committed-model sanity (runtime):** once `pieces.onnx` is committed, a `cv2.dnn`-only test loads it
  and classifies a handful of crops drawn from M3's committed real-ish fixtures, asserting sensible
  labels with reasonable confidence (no torch/HF needed — runs in CI).
- Tests needing torch/HF are marked `convert` and skipped in a runtime-only environment; plumbing and the
  committed-model sanity test run without them.

## 12. Build order (de-risk the inference contract first)

1. **Inference + contract** (`pieces.py`): preprocessing, class map, `PieceClassifier`, validated with a
   tiny in-test ONNX model. Ships; no torch.
2. **Conversion script** (`scripts/convert_pieces_model.py`): fetch weights, replicate arch, load with
   layout fixes, export ONNX; round-trip test.
3. **Validate + commit**: run conversion, pass the openboard accuracy gate, commit `pieces.onnx` +
   `NOTICE.md`, add the committed-model sanity test.

## 13. Dependencies

- **Runtime:** none new — `cv2` (`opencv-python-headless`), `numpy`, `python-chess` already present.
- **Dev-time `[convert]` extra:** `torch` (CPU), `safetensors`, `huggingface_hub`, `onnx`. All have
  Python 3.14 wheels (verified). `pieces.py` stays PyInstaller-clean (no torch import).

## 14. Deliverable / acceptance

- `PieceClassifier().classify(64 crops) -> 64 SquareLabel`s, in input order, each with confidence,
  feeding directly into M4a's `assemble`.
- A committed `chessmenthol/models/pieces.onnx` (<1 MB) converted from chess-cv, loaded via `cv2.dnn`,
  reproducing ~98% accuracy on `chess-cv-openboard` and sane labels on M3 fixtures.
- A reproducible `scripts/convert_pieces_model.py` behind the `[convert]` extra; runtime app gains **no**
  new dependency. MIT attribution recorded in `NOTICE.md`.
- No server/frontend/CLI-app changes.

## 15. Risks & open questions

- **Conversion fidelity (primary risk now):** replicating chess-cv's `SimpleCNN` and mapping MLX weights
  (esp. conv layout `(out,kH,kW,in)` → `(out,in,kH,kW)`, and any BN/linear naming) must be exact. The
  openboard accuracy gate is the decisive check — a wrong conversion scores near-random. If conversion
  proves intractable after real effort, escalate (a fallback is to retrain a torch `SimpleCNN` on
  chess-cv-style synthetic data, deferred to a future milestone — out of scope here).
- **Preprocessing mismatch:** the converted model expects chess-cv's exact inference normalization; we
  pin it from chess-cv's source, and the accuracy gate catches a mismatch.
- **`cv2.dnn` op support:** chess-cv's CNN uses conv/BN/ReLU/pool/GEMM/softmax — all `cv2.dnn`-supported;
  the round-trip test guards it. (If `cv2.dnn` rejects an op, the plan can fold softmax into Python and
  export only up to logits.)
- **Real-site generalization beyond openboard:** chess-cv reports 92–98% across real datasets; some
  themes may be weaker. Per-square confidence flagging (M4a) surfaces misreads for edit-mode correction
  (M5); deeper real validation comes in M4c.
- **License/attribution:** MIT permits redistribution of the derived model with attribution; `NOTICE.md`
  records it.
