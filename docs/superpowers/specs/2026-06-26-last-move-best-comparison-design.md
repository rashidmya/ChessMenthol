# Last-move best-move comparison — Design Spec

**Date:** 2026-06-26
**Status:** Approved for planning
**Scope:** Frontend "Last move" panel + a small server payload widening. Builds on the existing
single-board analysis pipeline (M1–M4, M5a all on `main`). No new milestone; a focused UX
improvement requested against the live app.

## 1. Overview

Today the "Last move" box shows a single compact pill (`Badge.svelte`) with just the move's
classification label (e.g. a green "best" chip). This spec enriches it into a chess.com-style
comparison: **when the played move was not the best move, show two rows — the move you played and
the engine's best move — each with its white-POV eval and a short continuation, and make the best
move clickable to undo the played move and play the best move instead.**

Reference (user screenshot):

```
+5.03  ✗  Nc3 is a mistake
             16... ♟xc3
+2.27  ✓  Nec5 is best          ← clickable: undo + play best
             16... O-O-O 17. ♘d7 ♗g3
```

All the data needed already exists on the server at classification time. The change is one widened
payload field plus a new frontend component; the engine, tracking, eval bar, and Engine-lines panel
are untouched.

## 2. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Notation | **Mixed.** The move *name* uses plain letters (`Nc3`, `Nec5`); the *continuation* uses figurine glyphs (`♟xc3`, `♘d7`, `♗g3`). Filled (black) unicode glyph set for all pieces regardless of color, matching the screenshot. |
| Best move was played (`isBest`) | **Single green row** — `"<san> is best"` with its eval + continuation. No clickable button (it is already best). |
| Continuation length | **~3 plies, truncated** with a trailing `…` when the engine PV is longer. Keeps the 320px side panel compact. |
| Eval point of view | **White POV** for both rows (`+5.03` / `+2.27`), consistent with `format_white()`, the eval bar, and the Engine-lines panel. |
| Clickable best mechanics | **Reuse existing commands**: the frontend sends `undo` then `make_move(bestUci)`. No new server command. |
| `Badge.svelte` | **Replaced** by the new `LastMove.svelte` (the box's entire content is what we are changing). |

## 3. Architecture

The change touches the two existing layers; it adds no new ones and no new dependencies or protocol
commands.

- **Server (`chessmenthol/server/`)** — widen the `lastMove` payload built when a move is
  classified. The data (`board_before`, played `move`, `before_a.best`, after-analysis) is already
  in hand inside `Orchestrator._on_update`; we add a pure `serialize.last_move_to_dict(...)` helper
  so the orchestrator method stays thin and the assembly is unit-testable.
- **Frontend (`frontend/src/`)** — a pure `lib/figurine.ts` util, a new `components/LastMove.svelte`
  (replacing `Badge.svelte`), a widened `LastMoveDto`, and a one-line `onPlayBest` wiring in
  `App.svelte`.

### Data flow

```
make_move(uci)
  └─ Orchestrator stores _pending = (board_before, move, before_a)   [before_a = analysis of board_before]
_on_update(after_analysis)   (once depth ≥ CLASSIFY_MIN_DEPTH)
  └─ c = classify_move(...)  → Classification
  └─ serialize.last_move_to_dict(c, board_before, move, before_a, after_analysis)
       → { classification, played{san,evalText,pv}, best{san,uci,evalText,pv} }
  └─ pushed in the state frame as `lastMove`
Frontend
  └─ LastMove.svelte renders two rows; figurine.ts glyph-converts the continuation strings
  └─ click best → onPlayBest(bestUci) → send(undo); send(make_move bestUci)
```

## 4. Server changes

### 4.1 `serialize.last_move_to_dict(board_before, move, before_a, after_a) -> dict`

A new pure function in `chessmenthol/server/serialize.py`. Preconditions (already guaranteed by the
caller): `before_a.best is not None`. Builds:

```python
{
  "classification": classification_to_dict(c),     # {label, cpl, isBest} — unchanged shape
  "played": {
      "san":      board_before.san(move),
      "evalText": after_a.best.eval.format_white(),         # e.g. "+5.03"
      "pv":       _variation_san_after(board_before, move, after_a.best.pv, PV_PLIES),
  },
  "best": {
      "san":      board_before.san(best_move),
      "uci":      best_move.uci(),
      "evalText": before_a.best.eval.format_white(),         # e.g. "+2.27"
      "pv":       _best_continuation_san(board_before, before_a.best.pv, PV_PLIES),
  },
}
```

- `best_move = before_a.best.move`.
- **Played continuation** = the engine PV from the position *after the played move*
  (`after_a.best.pv`), rendered with `board_after.variation_san(pv[:PV_PLIES])`. A trailing `…` is
  appended (inside the helper) when `len(pv) > PV_PLIES`.
- **Best continuation** = `before_a.best.pv[1:]` (drop the best move itself, since it is the row's
  move name), rendered from the position *after the best move* with `variation_san(pv[1:][:PV_PLIES])`,
  same `…` rule.
- `PV_PLIES = 3` — a module constant next to `CLASSIFY_MIN_DEPTH`-style constants.
- The classification helper takes the already-computed `Classification` (the orchestrator still calls
  `classify_move` once; `last_move_to_dict` receives the result, so we don't classify twice). Signature
  carries `c: Classification` as well; final form:
  `last_move_to_dict(c, board_before, move, before_a, after_a) -> dict`.

Both continuation helpers are pure and individually unit-testable (numbering, truncation, the `…`).

### 4.2 `Orchestrator._on_update`

Replace the inline `self._last_move = {...}` block (orchestrator.py ~258) with a call to
`serialize.last_move_to_dict(c, board_before, move, before_a, analysis)`. No other orchestrator
change. `_reset_move_state` / `_last_move = None` paths are unchanged, so the panel still clears on
any board mutation.

### 4.3 What is *not* changed

- `make_move` / `undo` handlers — reused verbatim by the clickable-best flow.
- No new protocol command, no engine/tracking/eval changes.

## 5. Frontend changes

### 5.1 `lib/types.ts` — widen `LastMoveDto`

```ts
export interface LastMovePvDto { san: string; evalText: string; pv: string; }
export interface LastMoveDto {
  classification: ClassificationDto;
  played: LastMovePvDto;
  best:   LastMovePvDto & { uci: string };
}
```

### 5.2 `lib/figurine.ts` — pure `toFigurine(san: string): string`

Converts a (possibly numbered, multi-move) SAN/variation string to figurine notation:

- Split on whitespace; for each token strip a leading move-number prefix (`^\d+\.+`) and keep it
  verbatim (e.g. `16...`, `17.`).
- In the remaining SAN, replace a leading piece letter `K Q R B N` with the filled glyph
  (`♚ ♛ ♜ ♝ ♞`). Promotion suffix letters (`=Q`) are converted too.
- If the SAN is a pawn move (first char not in `KQRBNO`), prepend the pawn glyph `♟`.
- Castling (`O-O`, `O-O-O`) and the trailing `…` are passed through untouched.

Pure, no dependencies, exhaustively unit-tested (piece moves, pawn captures, castling, promotion,
check/mate suffixes, numbered black-to-move strings, the `…`).

### 5.3 `components/LastMove.svelte` — replaces `Badge.svelte`

Props: `lastMove: LastMoveDto | null`, `onPlayBest: (uci: string) => void`.

- **`lastMove == null`** → render nothing (same as today).
- **`classification.isBest`** → one green ✓ row: `"<played.san> is best"` + eval chip +
  `toFigurine(best.pv)` continuation. No button.
- **otherwise** → two rows:
  - Row 1 (played): eval chip (`played.evalText`) · label-colored ✗ icon · `"<played.san> is <phrase>"`
    · `toFigurine(played.pv)`.
  - Row 2 (best): green eval chip (`best.evalText`) · ✓ · a real `<button>` reading
    `"<best.san> is best"` (title "Undo and play the best move") that calls `onPlayBest(best.uci)`
    · `toFigurine(best.pv)`.
- `phraseFor(label)` map: `best→"best"`, `mistake→"a mistake"`, `blunder→"a blunder"`,
  `inaccuracy→"an inaccuracy"`, `miss→"a miss"`, `excellent→"excellent"`, `good→"good"`,
  `brilliant→"brilliant"`, `great→"great"`, `book→"a book move"`.
- Reuse the existing per-label colors from `Badge.svelte` for the played-row accent; the best row is
  always green. Eval chips styled like the screenshot's left chips.

### 5.4 `App.svelte`

- Swap `import Badge` → `import LastMove`; in the "Last move" box render
  `<LastMove lastMove={s?.lastMove ?? null} onPlayBest={playBest} />`.
- Add `function playBest(uci: string) { send({ type: 'undo' }); send({ type: 'make_move', uci }); }`.
  Commands are ordered over the socket and applied sequentially under the orchestrator lock, so this
  lands on `board_before` and then plays the best move (which re-classifies as "best").

### 5.5 Removed / added files

- **Remove:** `components/Badge.svelte`, `tests/Badge.test.ts`.
- **Add:** `components/LastMove.svelte`, `tests/LastMove.test.ts`, `lib/figurine.ts`,
  `tests/figurine.test.ts`.

## 6. Testing

- **Python** (`tests/`): `last_move_to_dict` — best-not-played (two distinct sans/evals/pvs),
  best-played (`isBest`), continuation numbering + 3-ply truncation + `…`, and that `bestUci` is the
  engine's best move's UCI. Pure helpers tested without a live engine via constructed
  `AnalysisInfo`/`Board` fixtures (consistent with existing classify/serialize tests).
- **Frontend** (`src/tests/`): `figurine.test.ts` (full conversion matrix above);
  `LastMove.test.ts` (renders two rows when not best; single green row when `isBest`; clicking the
  best button calls `onPlayBest` with `best.uci`; phrase mapping; renders nothing when null).

## 7. Out of scope (YAGNI)

- A dedicated atomic `play_best` server command (the `undo`+`make_move` pair is sufficient and
  reuses tested handlers; the brief double-restart on a single click is acceptable).
- Making the *played* move clickable, hover preview of variations, or a full move-list with
  per-move quality dots (the move list was already deferred in M5a).
- Figurine notation in the Engine-lines panel (stays plain SAN, unchanged).
- Mate-score eval text styling beyond the existing `format_white()` `#N` output.
