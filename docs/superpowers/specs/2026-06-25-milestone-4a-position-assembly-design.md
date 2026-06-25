# Milestone 4a — Position Assembly — Design Spec

**Date:** 2026-06-25
**Status:** Approved for planning
**Parent:** [`2026-06-24-chessmenthol-design.md`](2026-06-24-chessmenthol-design.md) §6.4 `position`

## 1. Overview

Milestone 4 (piece classifier → live analysis) is decomposed into three independent sub-projects,
each with its own spec → plan → TDD cycle:

- **M4a — Position assembly** (this spec): pure chess logic that turns detected square-labels into a
  legal board. No ML, `python-chess` only.
- **M4b — Piece classifier**: synthetic-data CNN → ONNX → `onnxruntime` inference over the 64 crops.
- **M4c — Live integration**: the capture→detect→classify→position→engine orchestration loop wired
  into the existing M2 server/frontend.

This spec covers **M4a only**. It builds the `position` module: given an 8×8 grid of per-square
labels plus a board orientation and side-to-move, it assembles a **legal** `python-chess`
board/FEN, infers the move played between two consecutive positions, conservatively infers castling
and en-passant, and flags low-confidence squares. It is built and tested entirely against mock
labels (golden positions) — no classifier is required yet.

## 2. Goals

- Assemble a geometric 8×8 label grid + orientation + side-to-move into a `python-chess` board and FEN.
- Apply orientation **late** so flipping the board is a re-assemble, never a re-classification.
- Infer the move played between a previous board and a newly-detected placement (Option A: legal-move
  enumeration + placement match).
- Conservatively infer castling rights and en-passant from the snapshot/diff.
- Validate legality and **never** surface an illegal board for engine analysis; flag it for correction.
- Flag squares whose label confidence is below a threshold.
- Provide **stateless** orientation / side-to-move guesser helpers (callers own the stateful tracking).

## 3. Non-Goals (this milestone)

- **No piece classification / ML** — that is M4b. M4a consumes `SquareLabel`s produced by mock data
  in tests and by the classifier later.
- **No live orchestration, no stateful tracking, no live-vs-working position state machine** — that is
  M4c. M4a's guessers are pure functions; the caller decides how to use them and how to apply user
  overrides.
- **No server/WebSocket/frontend changes.**
- **No CLI.** M4a's deliverable is an internal, fully-tested module.
- **No new dependencies.** `python-chess` is already a project dependency.

## 4. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| M4 decomposition | Three sub-projects: **M4a position** → M4b classifier → M4c live integration. Position first (pure logic, no risky deps, deterministic glue). |
| Inference boundary | `position` is a **pure assembler + stateless guessers**. Stateful tracking, last-move-highlight wiring, user overrides, and live-vs-working position belong to M4c. |
| Move inference | **Option A** — enumerate `prev_board.legal_moves`, match the resulting piece placement (`board_fen()`) to the detected placement; unique match wins, else `None`. Correct-by-construction for castling/en-passant/promotion. |
| Orientation | A **late-bound input** to `assemble`, applied when mapping geometric `(col,row)` to a chess square; flipping the board re-assembles the same labels under a different orientation. |
| Input shape | An **8×8 geometric** `list[list[SquareLabel]]` (`grid[row][col]`, row 0 = board top, col 0 = left). |
| Module location | Top-level `chessmenthol/position.py`, `python-chess`-only. |
| Shared geometry | Move the existing pure `square_name(col,row,orientation)` out of `vision/detect.py` into the cv2-free `vision/types.py`, imported by both `detect.py` and `position.py` (avoids duplication and a cv2 dependency in `position`). |

## 5. Module layout

```
chessmenthol/position.py        # SquareLabel, AssembledPosition, assemble, infer_move,
                                # guess_orientation, guess_side_to_move
chessmenthol/vision/types.py    # gains square_name(col,row,orientation)  (moved from detect.py)
chessmenthol/vision/detect.py   # imports square_name from .types instead of defining it
tests/test_position.py          # golden-position tests
```

`position.py` imports `chess` and `square_name` (from `chessmenthol.vision.types`, which imports
neither cv2 nor chess). It does **not** import the `vision` capture/detect stack.

### 5.1 Targeted cleanup: relocate `square_name`

`square_name(col, row, orientation)` is currently defined in `vision/detect.py` (which imports cv2)
and used by `crop_squares`/`overlay`. It is a pure geometry→algebra mapping with no CV dependency.
Move it verbatim to `vision/types.py`; re-export/import it in `detect.py` so existing call sites and
tests are unchanged; import it in `position.py`. This is the only change to existing files.

## 6. Data types (`position.py`)

- `SquareLabel` (frozen dataclass): `piece: chess.Piece | None`, `confidence: float`. `piece=None`
  means an empty square. Produced by tests here; by the classifier in M4b.
- `AssembledPosition` (frozen dataclass):
  - `fen: str` — always a best-guess FEN, even when illegal.
  - `board: chess.Board | None` — the legal board, or `None` when the placement is invalid (so it can
    never be analyzed by accident).
  - `is_legal: bool`
  - `status: str` — human-readable reason from `chess.Board.status()` when illegal (e.g.
    `"too many white pawns"`), `"valid"` otherwise.
  - `low_confidence: list[str]` — algebraic square names whose label confidence is below the threshold.
  - `move: chess.Move | None` — the inferred move (only when `prev_board` was supplied).
  - `orientation: str` and `side_to_move: chess.Color` — echoed back for the caller's convenience.

## 7. `assemble`

```
assemble(grid, *, orientation, side_to_move, prev_board=None, confidence_threshold=0.5)
    -> AssembledPosition
```

`grid` is an 8×8 `list[list[SquareLabel]]`, geometric (`grid[row][col]`, row 0 = top, col 0 = left).

1. `board = chess.Board.empty()`; for each `(row, col)` with a non-empty label, place the piece on
   `square_name(col, row, orientation)`; set `board.turn = side_to_move`.
2. **Conservative castling rights:** for each color, grant a castling right only if that color's king
   is on its home square **and** the corresponding rook is on its home square (white: K on e1 with
   rook on h1 → white K-side; rook on a1 → white Q-side; black: e8 with h8/a8). A snapshot cannot
   prove a right was never lost, so this is the permissive-but-bounded inference; it is overridable by
   the caller in M4c.
3. **En-passant:** only when `prev_board` is supplied and the inferred move is a two-square pawn push;
   set the resulting ep square. Otherwise no ep square.
4. **Legality:** compute `status = board.status()`; `is_legal = status == chess.STATUS_VALID`. Build
   `fen` from the placement regardless. When illegal, set `board=None` and record the status string.
5. **Low-confidence:** collect `square_name(col,row,orientation)` for every label with
   `confidence < confidence_threshold` (including empty-square labels, since a low-confidence "empty"
   is still suspect).
6. **Move inference:** if `prev_board` is given and the new board is legal,
   `move = infer_move(prev_board, board)`.
7. Return the `AssembledPosition`.

The order matters: castling/ep are set before the legality check so `status()`/`fen` reflect the full
board state.

## 8. `infer_move` (Option A)

```
infer_move(prev_board, new_board) -> chess.Move | None
```

For each `move` in `prev_board.legal_moves`: copy `prev_board`, `push(move)`, and compare
`copy.board_fen()` to `new_board.board_fen()` (the piece-placement field only — ignores
side-to-move/castling/ep, which detection cannot observe). Return the single matching move. If zero
moves match (no legal single-move transition — e.g. several moves were played between captures) or
more than one matches (not possible for distinct legal moves, but guarded), return `None`.

This is correct-by-construction: castling, en-passant, and promotion (including underpromotion) each
produce a distinct placement that python-chess already enumerates, so no chess-rule logic is
reimplemented.

## 9. Stateless guessers

These are best-effort pure helpers; M4c owns the stateful decision (with user override) of what
orientation/side-to-move to actually pass into `assemble`.

- `guess_orientation(grid) -> "white_bottom" | "black_bottom" | None` — inspects the piece layout:
  compares the two outermost geometric rows on each side; returns `white_bottom` when the bottom edge
  holds predominantly white pieces and the top edge predominantly black, `black_bottom` for the
  mirror, and `None` when the signal is ambiguous (too few pieces or mixed).
- `guess_side_to_move(prev_board, move, highlight_squares) -> chess.Color` — if a `move` was inferred,
  the side to move is the opponent of the mover (`not prev_board.turn`). Otherwise, if a last-move
  `highlight_squares` pair is available, the side to move is the opposite color of the piece now
  sitting on the highlighted destination square. Falls back to `chess.WHITE` when nothing is known.

## 10. Error handling (parent spec §8)

- **Illegal/ambiguous placement:** `is_legal=False`, a status reason, a best-guess FEN, and
  `board=None`. The caller (M4c) shows the FEN, nudges the user to edit-mode, and **never** sends an
  illegal board to the engine. No exception is raised — bad detections are an expected, flagged
  outcome.
- **Ambiguous / no single move:** `move=None`.
- **Missing/duplicate kings, pawns on the back rank, etc.:** surfaced through `status` (python-chess
  `status()` reports these).

## 11. Testing strategy (TDD, golden positions)

All tests use `python-chess` to build ground truth — no images, no model.

- **Round-trip:** take a known `chess.Board` (start position, a midgame FEN, an endgame FEN), render
  its placement into a geometric grid (helper), `assemble` under the matching orientation, and assert
  the resulting `board_fen()` equals the original placement.
- **Orientation:** the same physical layout assembled under `white_bottom` vs `black_bottom` yields
  correctly mirrored square assignments.
- **Castling inference:** kings + rooks on home squares → rights granted; a rook off its home square →
  that right withheld; both sides covered.
- **En-passant:** a double pawn push between `prev_board` and the new placement sets the ep square;
  a quiet move does not.
- **Legality:** two white kings, a pawn on rank 1/8, and a missing king each yield `is_legal=False`
  with the expected `status`, a non-empty `fen`, and `board=None`.
- **`infer_move` golden cases:** quiet move, capture, **O-O and O-O-O**, **promotion to queen and
  underpromotion to knight**, **en-passant**; a two-move jump → `None`; an unreachable placement →
  `None`.
- **Guessers:** `guess_orientation` on a clear start-position grid (both orientations) and an
  ambiguous near-empty grid (`None`); `guess_side_to_move` from an inferred move and from a highlight
  pair.
- **Low-confidence:** labels below the threshold (pieces and empties) appear in `low_confidence` with
  correct algebraic names; above-threshold labels do not.
- **Cleanup regression:** the existing `vision` suite still passes after `square_name` is relocated.

## 12. Deliverable / acceptance

- `chessmenthol/position.py` assembles a geometric label grid + orientation + side-to-move into a
  legal `python-chess` board/FEN, infers single-move transitions (incl. castling/promotion/ep), infers
  castling/ep conservatively, and flags low-confidence squares — all covered by golden tests.
- `square_name` is relocated to `vision/types.py` with the full existing `vision` suite still green.
- No new dependencies; no server/frontend/CLI changes.

## 13. Risks & open questions

- **Castling over-granting:** the home-square heuristic grants a right even if the king/rook moved out
  and back. This is rare, conservative-for-analysis (an extra legal option, not a wrong position), and
  overridable in M4c. Acceptable.
- **`guess_orientation` robustness:** layout heuristics can be ambiguous mid-game (e.g. symmetric
  positions). Returning `None` when unsure (deferring to the detection hint + user override) is the
  safe behavior; the detection `orientation_hint` from M3 remains the primary source.
- **Move inference only handles single-move transitions.** Intentional — multi-move jumps return
  `None` and simply skip move classification that turn; the position still assembles.
