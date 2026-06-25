# Milestone 4a — Position Assembly — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `chessmenthol/position.py` — turn an 8×8 grid of detected square-labels + orientation + side-to-move into a legal `python-chess` board/FEN, infer the move played between consecutive positions, conservatively infer castling/en-passant, and flag low-confidence squares.

**Architecture:** A standalone `python-chess`-only module. Orientation is applied late (geometric `(col,row)` → algebraic via `square_name`), so flipping the board is a re-assemble, not a re-classification. Move inference enumerates `prev_board.legal_moves` and matches the resulting piece placement (correct-by-construction for castling/ep/promotion). One small cleanup relocates the pure `square_name` helper from `vision/detect.py` (which imports cv2) to the cv2-free `vision/types.py` so `position` stays decoupled from the CV stack.

**Tech Stack:** Python 3.11+, `python-chess` (already a dependency). No new deps.

**Reference spec:** `docs/superpowers/specs/2026-06-25-milestone-4a-position-assembly-design.md`

**Conventions:** Every Python file starts with `from __future__ import annotations`. Run tests with `.venv/bin/pytest`. `chess.Color` is `bool` (`chess.WHITE=True`, `chess.BLACK=False`).

---

## File Structure

| File | Responsibility |
|---|---|
| `chessmenthol/vision/types.py` | **Modify** — gains `square_name(col,row,orientation)` (moved from `detect.py`) |
| `chessmenthol/vision/detect.py` | **Modify** — imports `square_name` from `.types` instead of defining it |
| `chessmenthol/position.py` | **Create** — `SquareLabel`, `AssembledPosition`, `assemble`, `infer_move`, `guess_orientation`, `guess_side_to_move` |
| `tests/position_grids.py` | **Create** — `board_to_grid` test helper (chess.Board → 8×8 geometric grid) |
| `tests/test_position.py` | **Create** — golden-position tests |

---

## Task 1: Relocate `square_name` to `vision/types.py`

Pure refactor — no behavior change. `square_name` is a geometry→algebra mapping with no cv2 dependency; moving it lets `position.py` import it without pulling opencv. The existing `vision` tests are the safety net.

**Files:**
- Modify: `chessmenthol/vision/types.py`
- Modify: `chessmenthol/vision/detect.py`
- Test: `tests/vision/test_types.py`

- [ ] **Step 1: Add a test pinning `square_name` at its new home**

Append to `tests/vision/test_types.py`:

```python
from chessmenthol.vision.types import square_name


def test_square_name_in_types():
    assert square_name(0, 0, "white_bottom") == "a8"
    assert square_name(7, 7, "white_bottom") == "h1"
    assert square_name(0, 0, "black_bottom") == "h1"
    assert square_name(0, 0, None) == "a8"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/pytest tests/vision/test_types.py::test_square_name_in_types -v`
Expected: FAIL — `ImportError: cannot import name 'square_name'`.

- [ ] **Step 3: Move the function into `types.py`**

In `chessmenthol/vision/types.py`, add (after the `Orientation` type alias near the top, below the imports):

```python
def square_name(col: int, row: int, orientation: Optional[str]) -> str:
    """Map geometric (col, row) — (0,0) at board top-left — to algebraic.

    Defaults to the white_bottom convention when orientation is None.
    """
    if orientation == "black_bottom":
        return f"{chr(ord('h') - col)}{row + 1}"
    return f"{chr(ord('a') + col)}{8 - row}"
```

- [ ] **Step 4: Update `detect.py` to import it**

In `chessmenthol/vision/detect.py`, delete the local `def square_name(...)` definition. Then change the `.types` import line to include `square_name`:

```python
from .types import BoardLocation, ImageLike, Region, SquareImage, as_image, square_name
```

(`overlay.py` and `tests/vision/test_detect.py` do `from chessmenthol.vision.detect import square_name`; that keeps working because `detect.py` now re-exports the imported name.)

- [ ] **Step 5: Run the whole vision suite + the new test**

Run: `.venv/bin/pytest tests/vision -v`
Expected: PASS — all existing vision tests plus `test_square_name_in_types` (no regressions).

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/vision/types.py chessmenthol/vision/detect.py tests/vision/test_types.py
git commit -m "refactor(vision): relocate square_name to types so position can reuse it"
```

---

## Task 2: `SquareLabel`, `AssembledPosition`, and the grid test helper

**Files:**
- Create: `chessmenthol/position.py`
- Create: `tests/position_grids.py`
- Test: `tests/test_position.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_position.py`:

```python
from __future__ import annotations

import chess

from chessmenthol.position import AssembledPosition, SquareLabel
from tests.position_grids import board_to_grid


def test_square_label_holds_piece_and_confidence():
    label = SquareLabel(piece=chess.Piece(chess.QUEEN, chess.WHITE), confidence=0.9)
    assert label.piece.symbol() == "Q"
    assert label.confidence == 0.9
    empty = SquareLabel(piece=None, confidence=0.1)
    assert empty.piece is None


def test_assembled_position_fields():
    ap = AssembledPosition(
        fen="8/8/8/8/8/8/8/8 w - - 0 1",
        board=None,
        is_legal=False,
        status="empty",
        low_confidence=[],
        move=None,
        orientation="white_bottom",
        side_to_move=chess.WHITE,
    )
    assert ap.is_legal is False
    assert ap.orientation == "white_bottom"


def test_board_to_grid_roundtrips_piece_positions():
    board = chess.Board()  # start position
    grid = board_to_grid(board, "white_bottom")
    assert len(grid) == 8 and len(grid[0]) == 8
    # geometric top-left (row0,col0) is a8 under white_bottom -> black rook
    assert grid[0][0].piece == chess.Piece(chess.ROOK, chess.BLACK)
    # geometric bottom-right (row7,col7) is h1 -> white rook
    assert grid[7][7].piece == chess.Piece(chess.ROOK, chess.WHITE)
    # an empty middle square
    assert grid[4][4].piece is None
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_position.py -v`
Expected: FAIL — `ModuleNotFoundError: chessmenthol.position`.

- [ ] **Step 3: Create `position.py` with the dataclasses**

Create `chessmenthol/position.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import chess

from chessmenthol.vision.types import square_name


@dataclass(frozen=True)
class SquareLabel:
    """One classified square. `piece=None` means an empty square."""

    piece: Optional[chess.Piece]
    confidence: float


@dataclass(frozen=True)
class AssembledPosition:
    fen: str
    board: Optional[chess.Board]
    is_legal: bool
    status: str
    low_confidence: list[str]
    move: Optional[chess.Move]
    orientation: str
    side_to_move: chess.Color
```

- [ ] **Step 4: Create the grid test helper**

Create `tests/position_grids.py`:

```python
from __future__ import annotations

import chess

from chessmenthol.position import SquareLabel
from chessmenthol.vision.types import square_name


def board_to_grid(
    board: chess.Board, orientation: str = "white_bottom", confidence: float = 1.0
) -> list[list[SquareLabel]]:
    """Inverse of `assemble`'s placement step: render a board into an 8x8
    geometric grid (grid[row][col], row 0 = board top, col 0 = left)."""
    grid: list[list[SquareLabel]] = []
    for row in range(8):
        grid_row: list[SquareLabel] = []
        for col in range(8):
            sq = chess.parse_square(square_name(col, row, orientation))
            grid_row.append(SquareLabel(board.piece_at(sq), confidence))
        grid.append(grid_row)
    return grid
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest tests/test_position.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/position.py tests/position_grids.py tests/test_position.py
git commit -m "feat(position): add SquareLabel/AssembledPosition types and grid helper"
```

---

## Task 3: `assemble` — placement + legality

**Files:**
- Modify: `chessmenthol/position.py`
- Test: `tests/test_position.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_position.py`:

```python
from chessmenthol.position import assemble


def test_assemble_roundtrips_start_position():
    board = chess.Board()
    grid = board_to_grid(board, "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert ap.is_legal is True
    assert ap.status == "valid"
    assert ap.board is not None
    assert ap.board.board_fen() == board.board_fen()


def test_assemble_roundtrips_midgame():
    board = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3")
    grid = board_to_grid(board, "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert ap.board.board_fen() == board.board_fen()


def test_assemble_orientation_maps_geometric_origin():
    # white rook at geometric top-left (row0,col0); kings placed so BOTH
    # orientations yield a legal position (no checks, kings not adjacent).
    grid = [[SquareLabel(None, 1.0) for _ in range(8)] for _ in range(8)]
    grid[0][0] = SquareLabel(chess.Piece(chess.ROOK, chess.WHITE), 1.0)
    grid[7][7] = SquareLabel(chess.Piece(chess.KING, chess.WHITE), 1.0)
    grid[3][3] = SquareLabel(chess.Piece(chess.KING, chess.BLACK), 1.0)
    wb = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    bb = assemble(grid, orientation="black_bottom", side_to_move=chess.WHITE)
    # top-left geometric square is a8 under white_bottom, h1 under black_bottom
    assert wb.board.piece_at(chess.A8) == chess.Piece(chess.ROOK, chess.WHITE)
    assert bb.board.piece_at(chess.H1) == chess.Piece(chess.ROOK, chess.WHITE)


def test_assemble_illegal_two_white_kings():
    grid = [[SquareLabel(None, 1.0) for _ in range(8)] for _ in range(8)]
    grid[7][0] = SquareLabel(chess.Piece(chess.KING, chess.WHITE), 1.0)
    grid[7][7] = SquareLabel(chess.Piece(chess.KING, chess.WHITE), 1.0)
    grid[0][0] = SquareLabel(chess.Piece(chess.KING, chess.BLACK), 1.0)
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert ap.is_legal is False
    assert ap.board is None
    assert "king" in ap.status
    assert ap.fen  # best-guess FEN still produced
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_position.py -k assemble -v`
Expected: FAIL — `ImportError: cannot import name 'assemble'`.

- [ ] **Step 3: Implement `assemble` (placement + legality)**

Add to `chessmenthol/position.py`:

```python
def _status_text(status: chess.Status) -> str:
    if status == chess.STATUS_VALID:
        return "valid"
    return ", ".join(flag.name.lower().replace("_", " ") for flag in status)


def assemble(
    grid: list[list[SquareLabel]],
    *,
    orientation: str,
    side_to_move: chess.Color,
    prev_board: Optional[chess.Board] = None,
    confidence_threshold: float = 0.5,
) -> AssembledPosition:
    board = chess.Board.empty()
    for row in range(8):
        for col in range(8):
            label = grid[row][col]
            if label.piece is not None:
                square = chess.parse_square(square_name(col, row, orientation))
                board.set_piece_at(square, label.piece)
    board.turn = side_to_move

    status = board.status()
    is_legal = status == chess.STATUS_VALID
    # en_passant="fen" so a set ep square always shows (python-chess's default
    # "legal" mode hides it when no ep capture is currently possible).
    fen = board.fen(en_passant="fen")
    return AssembledPosition(
        fen=fen,
        board=board if is_legal else None,
        is_legal=is_legal,
        status=_status_text(status),
        low_confidence=[],
        move=None,
        orientation=orientation,
        side_to_move=side_to_move,
    )
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/test_position.py -v`
Expected: PASS (all, including the 4 new assemble tests). Note: `_status_text` relies on `chess.Status` being an `IntFlag` whose members iterate (python-chess); `"too many kings"` contains `"king"`, satisfying the assertion.

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/position.py tests/test_position.py
git commit -m "feat(position): assemble placement into a board with legality check"
```

---

## Task 4: Low-confidence flagging

**Files:**
- Modify: `chessmenthol/position.py`
- Test: `tests/test_position.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_position.py`:

```python
def test_assemble_flags_low_confidence_squares():
    board = chess.Board()
    grid = board_to_grid(board, "white_bottom", confidence=0.9)
    # knock two squares below the default 0.5 threshold: a piece (a8) and an empty (e4)
    grid[0][0] = SquareLabel(grid[0][0].piece, 0.2)   # a8
    grid[4][4] = SquareLabel(None, 0.1)               # e4, low-confidence empty
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert set(ap.low_confidence) == {"a8", "e4"}


def test_assemble_no_low_confidence_when_all_above_threshold():
    grid = board_to_grid(chess.Board(), "white_bottom", confidence=0.95)
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert ap.low_confidence == []
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_position.py -k low_confidence -v`
Expected: FAIL — `low_confidence` is always `[]`.

- [ ] **Step 3: Implement the flagging**

In `chessmenthol/position.py`, inside `assemble`, replace `low_confidence=[],` in the return with a computed list. Add this just before the `return`:

```python
    low_conf = [
        square_name(col, row, orientation)
        for row in range(8)
        for col in range(8)
        if grid[row][col].confidence < confidence_threshold
    ]
```

And change the return to use it: `low_confidence=low_conf,`.

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/test_position.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/position.py tests/test_position.py
git commit -m "feat(position): flag low-confidence squares during assembly"
```

---

## Task 5: Conservative castling inference

**Files:**
- Modify: `chessmenthol/position.py`
- Test: `tests/test_position.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_position.py`:

```python
def test_assemble_grants_full_castling_for_start_position():
    grid = board_to_grid(chess.Board(), "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    # FEN castling field is the 3rd token
    assert ap.fen.split()[2] == "KQkq"


def test_assemble_withholds_castling_when_rook_off_home():
    board = chess.Board()
    board.remove_piece_at(chess.A1)  # white queen-side rook missing from home
    grid = board_to_grid(board, "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    castling = ap.fen.split()[2]
    assert "Q" not in castling  # queen-side white right withheld
    assert "K" in castling and "k" in castling and "q" in castling


def test_assemble_no_castling_when_kings_off_home():
    grid = [[SquareLabel(None, 1.0) for _ in range(8)] for _ in range(8)]
    grid[7][4] = SquareLabel(chess.Piece(chess.KING, chess.WHITE), 1.0)   # e1
    grid[7][0] = SquareLabel(chess.Piece(chess.ROOK, chess.WHITE), 1.0)   # a1
    grid[7][7] = SquareLabel(chess.Piece(chess.ROOK, chess.WHITE), 1.0)   # h1
    grid[3][3] = SquareLabel(chess.Piece(chess.KING, chess.BLACK), 1.0)   # d5 (off home)
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    # white may castle (king+rooks home); black cannot (king off home)
    castling = ap.fen.split()[2]
    assert "K" in castling and "Q" in castling
    assert "k" not in castling and "q" not in castling
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_position.py -k castling -v`
Expected: FAIL — castling field is `"-"` (no rights inferred yet).

- [ ] **Step 3: Implement conservative castling inference**

Add to `chessmenthol/position.py`:

```python
def _infer_castling_rights(board: chess.Board) -> chess.Bitboard:
    rights = chess.BB_EMPTY
    wk = chess.Piece(chess.KING, chess.WHITE)
    bk = chess.Piece(chess.KING, chess.BLACK)
    wr = chess.Piece(chess.ROOK, chess.WHITE)
    br = chess.Piece(chess.ROOK, chess.BLACK)
    if board.piece_at(chess.E1) == wk:
        if board.piece_at(chess.H1) == wr:
            rights |= chess.BB_H1
        if board.piece_at(chess.A1) == wr:
            rights |= chess.BB_A1
    if board.piece_at(chess.E8) == bk:
        if board.piece_at(chess.H8) == br:
            rights |= chess.BB_H8
        if board.piece_at(chess.A8) == br:
            rights |= chess.BB_A8
    return rights
```

Then in `assemble`, after `board.turn = side_to_move` and **before** `status = board.status()`, add:

```python
    board.castling_rights = _infer_castling_rights(board)
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/test_position.py -v`
Expected: PASS (all). The castling field in `fen` now reflects the home-square inference.

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/position.py tests/test_position.py
git commit -m "feat(position): conservatively infer castling rights from home squares"
```

---

## Task 6: `infer_move` (Option A)

**Files:**
- Modify: `chessmenthol/position.py`
- Test: `tests/test_position.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_position.py`:

```python
from chessmenthol.position import infer_move


def _after(board: chess.Board, uci: str) -> chess.Board:
    nxt = board.copy()
    nxt.push(chess.Move.from_uci(uci))
    return nxt


def test_infer_move_quiet():
    prev = chess.Board()
    assert infer_move(prev, _after(prev, "e2e4")) == chess.Move.from_uci("e2e4")


def test_infer_move_capture():
    prev = chess.Board("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1")
    assert infer_move(prev, _after(prev, "e4d5")) == chess.Move.from_uci("e4d5")


def test_infer_move_kingside_castle():
    prev = chess.Board("4k3/8/8/8/8/8/8/4K2R w K - 0 1")
    assert infer_move(prev, _after(prev, "e1g1")) == chess.Move.from_uci("e1g1")


def test_infer_move_queenside_castle():
    prev = chess.Board("4k3/8/8/8/8/8/8/R3K3 w Q - 0 1")
    assert infer_move(prev, _after(prev, "e1c1")) == chess.Move.from_uci("e1c1")


def test_infer_move_promotion_queen_vs_knight():
    prev = chess.Board("4k3/P7/8/8/8/8/8/4K3 w - - 0 1")
    assert infer_move(prev, _after(prev, "a7a8q")) == chess.Move.from_uci("a7a8q")
    assert infer_move(prev, _after(prev, "a7a8n")) == chess.Move.from_uci("a7a8n")


def test_infer_move_en_passant():
    prev = chess.Board("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1")
    assert infer_move(prev, _after(prev, "e5d6")) == chess.Move.from_uci("e5d6")


def test_infer_move_returns_none_for_multi_move_jump():
    prev = chess.Board()
    two = _after(prev, "e2e4")
    two.push(chess.Move.from_uci("e7e5"))
    assert infer_move(prev, two) is None


def test_infer_move_returns_none_for_unreachable_placement():
    prev = chess.Board()
    unreachable = chess.Board("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
    assert infer_move(prev, unreachable) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_position.py -k infer_move -v`
Expected: FAIL — `ImportError: cannot import name 'infer_move'`.

- [ ] **Step 3: Implement `infer_move`**

Add to `chessmenthol/position.py`:

```python
def infer_move(prev_board: chess.Board, new_board: chess.Board) -> Optional[chess.Move]:
    """Return the single legal move from prev_board whose resulting piece
    placement matches new_board, or None if zero or multiple match.

    Compares board_fen() (placement only) — ignores side-to-move/castling/ep,
    which a screenshot cannot observe. Correct-by-construction for castling,
    en-passant, and promotion (each yields a distinct placement).
    """
    target = new_board.board_fen()
    found: Optional[chess.Move] = None
    for move in prev_board.legal_moves:
        prev_board.push(move)
        matches = prev_board.board_fen() == target
        prev_board.pop()
        if matches:
            if found is not None:
                return None  # ambiguous (should not happen for distinct legal moves)
            found = move
    return found
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/test_position.py -k infer_move -v`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/position.py tests/test_position.py
git commit -m "feat(position): infer the played move via legal-move placement match"
```

---

## Task 7: Wire move inference + en-passant into `assemble`

**Files:**
- Modify: `chessmenthol/position.py`
- Test: `tests/test_position.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_position.py`:

```python
def test_assemble_reports_inferred_move():
    prev = chess.Board()
    new = _after(prev, "e2e4")
    grid = board_to_grid(new, "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.BLACK, prev_board=prev)
    assert ap.move == chess.Move.from_uci("e2e4")


def test_assemble_sets_ep_square_on_double_pawn_push():
    prev = chess.Board()
    new = _after(prev, "e2e4")
    grid = board_to_grid(new, "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.BLACK, prev_board=prev)
    assert ap.fen.split()[3] == "e3"  # ep target square behind the pushed pawn


def test_assemble_no_ep_on_quiet_move():
    prev = chess.Board()
    new = _after(prev, "g1f3")
    grid = board_to_grid(new, "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.BLACK, prev_board=prev)
    assert ap.fen.split()[3] == "-"
    assert ap.move == chess.Move.from_uci("g1f3")


def test_assemble_move_none_without_prev_board():
    grid = board_to_grid(chess.Board(), "white_bottom")
    ap = assemble(grid, orientation="white_bottom", side_to_move=chess.WHITE)
    assert ap.move is None
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_position.py -k "assemble_reports_inferred or ep_square or no_ep or move_none" -v`
Expected: FAIL — `move` is always `None` and no ep square is set.

- [ ] **Step 3: Implement move + en-passant wiring**

Add this helper to `chessmenthol/position.py`:

```python
def _maybe_set_ep_square(
    board: chess.Board, prev_board: chess.Board, move: chess.Move
) -> None:
    if prev_board.piece_type_at(move.from_square) != chess.PAWN:
        return
    from_rank = chess.square_rank(move.from_square)
    to_rank = chess.square_rank(move.to_square)
    if abs(from_rank - to_rank) == 2:
        file = chess.square_file(move.from_square)
        board.ep_square = chess.square(file, (from_rank + to_rank) // 2)
```

Then in `assemble`, after computing `is_legal` and **before** the `fen = board.fen(en_passant="fen")` line, add:

```python
    move = (
        infer_move(prev_board, board)
        if prev_board is not None and is_legal
        else None
    )
    if move is not None:
        _maybe_set_ep_square(board, prev_board, move)
```

(The ep square is set on `board` before `fen` is generated, so the `en_passant="fen"` mode renders it.)

And change the return to use the computed move: `move=move,`.

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/test_position.py -v`
Expected: PASS (all). The ep square is rendered in `fen` only when the inferred move is a two-square pawn push.

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/position.py tests/test_position.py
git commit -m "feat(position): wire inferred move and en-passant into assembly"
```

---

## Task 8: Stateless guessers

**Files:**
- Modify: `chessmenthol/position.py`
- Test: `tests/test_position.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_position.py`:

```python
from chessmenthol.position import guess_orientation, guess_side_to_move


def test_guess_orientation_white_bottom():
    grid = board_to_grid(chess.Board(), "white_bottom")
    assert guess_orientation(grid) == "white_bottom"


def test_guess_orientation_black_bottom():
    grid = board_to_grid(chess.Board(), "black_bottom")
    assert guess_orientation(grid) == "black_bottom"


def test_guess_orientation_ambiguous_returns_none():
    grid = [[SquareLabel(None, 1.0) for _ in range(8)] for _ in range(8)]
    grid[7][4] = SquareLabel(chess.Piece(chess.KING, chess.WHITE), 1.0)
    grid[0][4] = SquareLabel(chess.Piece(chess.KING, chess.BLACK), 1.0)
    assert guess_orientation(grid) is None  # too few pieces to tell


def test_guess_side_to_move_from_inferred_move():
    prev = chess.Board()  # white to move
    move = chess.Move.from_uci("e2e4")
    assert guess_side_to_move(chess.Board(), prev_board=prev, move=move) == chess.BLACK


def test_guess_side_to_move_from_highlight():
    # white pawn sits on the highlighted destination e4 -> white just moved -> black to move
    board = chess.Board("4k3/8/8/8/4P3/8/8/4K3 b - - 0 1")
    side = guess_side_to_move(board, highlight_squares=["e2", "e4"])
    assert side == chess.BLACK


def test_guess_side_to_move_defaults_white():
    assert guess_side_to_move(chess.Board()) == chess.WHITE
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_position.py -k guess -v`
Expected: FAIL — `ImportError: cannot import name 'guess_orientation'`.

- [ ] **Step 3: Implement the guessers**

Add to `chessmenthol/position.py`:

```python
def guess_orientation(grid: list[list[SquareLabel]]) -> Optional[str]:
    """Best-effort orientation from piece layout. Returns None when ambiguous.

    Compares the two outermost geometric rows on each edge: white pieces
    concentrated at the bottom (and black at the top) implies white_bottom.
    """

    def balance(rows: list[int]) -> tuple[int, int]:
        white = black = 0
        for r in rows:
            for label in grid[r]:
                if label.piece is not None:
                    if label.piece.color == chess.WHITE:
                        white += 1
                    else:
                        black += 1
        return white, black

    bottom_white, bottom_black = balance([6, 7])
    top_white, top_black = balance([0, 1])
    if bottom_white + bottom_black + top_white + top_black < 6:
        return None
    if bottom_white > bottom_black and top_black > top_white:
        return "white_bottom"
    if top_white > top_black and bottom_black > bottom_white:
        return "black_bottom"
    return None


def guess_side_to_move(
    board: chess.Board,
    *,
    prev_board: Optional[chess.Board] = None,
    move: Optional[chess.Move] = None,
    highlight_squares: Optional[list[str]] = None,
) -> chess.Color:
    """Best-effort side to move. The caller (M4c) owns user override."""
    if prev_board is not None and move is not None:
        return not prev_board.turn
    if highlight_squares:
        for name in highlight_squares:
            piece = board.piece_at(chess.parse_square(name))
            if piece is not None:
                return not piece.color
    return chess.WHITE
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/test_position.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/position.py tests/test_position.py
git commit -m "feat(position): add stateless orientation and side-to-move guessers"
```

---

## Task 9: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole repo test suite**

Run: `.venv/bin/pytest -q`
Expected: all tests pass — the prior 131 plus the new `tests/test_position.py` cases, with the `vision` suite still green after the `square_name` relocation. Engine tests still auto-skip without a bundled Stockfish.

- [ ] **Step 2: Confirm scope — no server/frontend/CLI drift**

Run: `git diff --stat main -- chessmenthol/server frontend chessmenthol/cli.py`
Expected: empty output (M4a touched none of these).

- [ ] **Step 3: Confirm `position` imports stay cv2-free**

Run: `.venv/bin/python -c "import chessmenthol.position, sys; assert 'cv2' not in sys.modules; print('position imports without cv2')"`
Expected: prints `position imports without cv2` (proves the decoupling from the CV stack).

- [ ] **Step 4: Final commit (only if anything was adjusted during verification)**

```bash
git add -A
git commit -m "test(position): milestone 4a full-suite verification" || echo "nothing to commit"
```

---

## Self-Review Notes (author)

- **Spec coverage:** types (§6 → Task 2), assemble placement+legality (§7.1/§7.4 → Task 3), low-confidence (§7.5 → Task 4), conservative castling (§7.2 → Task 5), infer_move Option A (§8 → Task 6), move+ep wiring (§7.3/§7.6 → Task 7), guessers (§9 → Task 8), square_name relocation (§5.1 → Task 1), error handling (§10 → verified in Tasks 3/6/7 via illegal/None cases), no-deps/no-drift (§12 → Task 9). All spec sections mapped.
- **Signature refinement:** `guess_side_to_move` takes the assembled `board` as its first arg (the spec's §9 prose says it reads "the piece now sitting on the highlighted destination square", which requires the board). Documented here; otherwise matches the spec intent.
- **Type consistency:** `SquareLabel(piece, confidence)`, `AssembledPosition` field names, and the signatures `assemble(grid, *, orientation, side_to_move, prev_board, confidence_threshold)`, `infer_move(prev_board, new_board)`, `guess_orientation(grid)`, `guess_side_to_move(board, *, prev_board, move, highlight_squares)` are used identically across Tasks 2–9. The 8×8 geometric `grid[row][col]` convention (row 0 top, col 0 left) is consistent with `board_to_grid` and `square_name`.
- **Placeholder scan:** every code step contains complete code; no TODO/TBD/"similar to" references.
