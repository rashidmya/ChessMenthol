# Last-move best-move comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the played move isn't the engine's best, show a chess.com-style two-row "Last move" panel (played vs best) with white-POV evals and short figurine continuations, and make the best row clickable to undo the played move and play the best move.

**Architecture:** The server already holds everything at classify time. We widen the `lastMove` payload via a new pure `serialize.last_move_to_dict(...)` helper (played/best SAN, white-POV eval text, truncated numbered continuation strings) and call it from `Orchestrator._on_update`. The frontend gets a pure `figurine.ts` util, a new `LastMove.svelte` (replacing `Badge.svelte`) rendering one or two rows, and an `onPlayBest` wiring in `App.svelte` that sends `undo` then `make_move(bestUci)` — no new protocol command.

**Tech Stack:** Python 3.14 + `python-chess` (server, pytest); Svelte 4 + TypeScript + Vitest + @testing-library/svelte (frontend).

**Spec:** `docs/superpowers/specs/2026-06-26-last-move-best-comparison-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `chessmenthol/server/serialize.py` (modify) | Add `PV_PLIES`, `_continuation_san`, `last_move_to_dict` — pure payload assembly. |
| `chessmenthol/server/orchestrator.py` (modify) | `_on_update` calls the new helper instead of inlining the dict. |
| `tests/server/test_serialize.py` (modify) | Unit tests for `last_move_to_dict` + continuation truncation. |
| `tests/server/test_orchestrator.py` (modify) | Update the existing `lastMove` assertion to the new shape. |
| `frontend/src/lib/figurine.ts` (create) | Pure `toFigurine(san)` — K/Q/R/B/N → filled glyphs; pawns/castling untouched. |
| `frontend/src/tests/figurine.test.ts` (create) | Conversion matrix. |
| `frontend/src/lib/types.ts` (modify) | Widen `LastMoveDto`; add `LastMovePvDto`. |
| `frontend/src/components/LastMove.svelte` (create) | One/two-row panel; clickable best button. |
| `frontend/src/tests/LastMove.test.ts` (create) | Rendering + click behavior. |
| `frontend/src/App.svelte` (modify) | Use `LastMove`; add `playBest`; drop `Badge` import. |
| `frontend/src/components/Badge.svelte` (delete) | Superseded by `LastMove.svelte`. |
| `frontend/src/tests/Badge.test.ts` (delete) | Superseded by `LastMove.test.ts`. |

---

## Task 1: Server — `last_move_to_dict` payload helper

**Files:**
- Modify: `chessmenthol/server/serialize.py`
- Test: `tests/server/test_serialize.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/test_serialize.py`. Add `last_move_to_dict` to the existing
`from chessmenthol.server.serialize import (...)` block (which already imports
`analysis_to_dict, classification_to_dict, eval_to_dict, line_to_dict`). `Classification`,
`MoveClass`, `AnalysisInfo`, `Eval`, `Line` and `chess` are already imported at the top of the file.

```python
def _line(cp, ucis, depth=20):
    return Line(1, Eval(cp=cp), depth, [chess.Move.from_uci(u) for u in ucis])


def test_last_move_to_dict_best_not_played():
    board = chess.Board()
    move = chess.Move.from_uci("a2a3")
    before = AnalysisInfo(board.fen(), 20,
                          [_line(227, ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"])])
    after_board = board.copy()
    after_board.push(move)
    after = AnalysisInfo(after_board.fen(), 20, [_line(503, ["e7e5", "g1f3"])])
    c = Classification(MoveClass.MISTAKE, 276, False)

    d = last_move_to_dict(c, board, move, before, after)

    assert d["classification"] == {"label": "mistake", "cpl": 276, "isBest": False}
    assert d["played"] == {"san": "a3", "evalText": "+5.03", "pv": "1...e5 2. Nf3"}
    assert d["best"] == {
        "san": "e4", "uci": "e2e4", "evalText": "+2.27",
        "pv": "1...e5 2. Nf3 Nc6 …",
    }


def test_last_move_to_dict_best_played_single():
    board = chess.Board()
    move = chess.Move.from_uci("e2e4")
    before = AnalysisInfo(board.fen(), 20, [_line(30, ["e2e4", "e7e5", "g1f3"])])
    after_board = board.copy()
    after_board.push(move)
    after = AnalysisInfo(after_board.fen(), 20, [_line(28, ["e7e5", "g1f3"])])
    c = Classification(MoveClass.BEST, 0, True)

    d = last_move_to_dict(c, board, move, before, after)

    assert d["classification"]["isBest"] is True
    assert d["best"] == {"san": "e4", "uci": "e2e4", "evalText": "+0.30",
                         "pv": "1...e5 2. Nf3"}
    assert d["played"]["san"] == "e4"
    assert d["played"]["evalText"] == "+0.28"


def test_last_move_to_dict_empty_continuation():
    board = chess.Board()
    move = chess.Move.from_uci("a2a3")
    before = AnalysisInfo(board.fen(), 20, [_line(50, ["e2e4"])])  # best move, no follow-up
    after_board = board.copy()
    after_board.push(move)
    after = AnalysisInfo(after_board.fen(), 20, [Line(1, Eval(cp=40), 20, [])])  # no pv
    c = Classification(MoveClass.INACCURACY, 10, False)

    d = last_move_to_dict(c, board, move, before, after)

    assert d["best"]["pv"] == ""    # before.best.pv[1:] is empty
    assert d["played"]["pv"] == ""  # after.best.pv is empty
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/pytest tests/server/test_serialize.py -k last_move_to_dict -v`
Expected: FAIL — `ImportError: cannot import name 'last_move_to_dict'`.

- [ ] **Step 3: Implement the helper**

Add to `chessmenthol/server/serialize.py` (after the existing `classification_to_dict`). The
top of the file already has `import chess` and
`from ..analysis.classify import Classification` and
`from ..engine.types import AnalysisInfo, Eval, Line`.

```python
PV_PLIES = 3  # plies of continuation to show after each move


def _continuation_san(board_after: chess.Board, pv: list, plies: int = PV_PLIES) -> str:
    """SAN of the first `plies` plies of `pv` from `board_after`, with a trailing
    ' …' when the real variation is longer. Empty string for an empty pv."""
    if not pv:
        return ""
    san = board_after.variation_san(pv[:plies])
    if len(pv) > plies:
        san += " …"
    return san


def last_move_to_dict(c: Classification, board_before: chess.Board, move: chess.Move,
                      before_a: AnalysisInfo, after_a: AnalysisInfo,
                      *, plies: int = PV_PLIES) -> dict:
    """Enriched `lastMove` payload comparing the played move to the engine's best.

    Preconditions (guaranteed by the caller): before_a.best and after_a.best are
    not None. Evals are white-POV strings (e.g. "+5.03"); continuations are
    numbered SAN truncated to `plies`. The best continuation drops the best move
    itself (it is already the row's name)."""
    best_line = before_a.best
    best_move = best_line.move
    after_played = board_before.copy()
    after_played.push(move)
    after_best = board_before.copy()
    after_best.push(best_move)
    return {
        "classification": classification_to_dict(c),
        "played": {
            "san": board_before.san(move),
            "evalText": after_a.best.eval.format_white(),
            "pv": _continuation_san(after_played, after_a.best.pv, plies),
        },
        "best": {
            "san": board_before.san(best_move),
            "uci": best_move.uci(),
            "evalText": best_line.eval.format_white(),
            "pv": _continuation_san(after_best, best_line.pv[1:], plies),
        },
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/pytest tests/server/test_serialize.py -v`
Expected: PASS (all serialize tests, including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/server/serialize.py tests/server/test_serialize.py
git commit -m "feat(server): add last_move_to_dict best-vs-played payload helper"
```

---

## Task 2: Server — wire the orchestrator to the helper

**Files:**
- Modify: `chessmenthol/server/orchestrator.py:257-262`
- Test: `tests/server/test_orchestrator.py:100-112`

- [ ] **Step 1: Update the existing orchestrator test to the new payload shape**

In `tests/server/test_orchestrator.py`, replace the body assertions of
`test_make_move_classifies_using_prior_analysis` (currently asserting
`state["lastMove"]["uci"] == "e2e4"`). The scenario plays `e2e4`, which is also the best move from
the prior analysis, so this is the `isBest` single-row case.

Replace:

```python
    assert state["lastMove"]["uci"] == "e2e4"
    assert state["lastMove"]["classification"]["label"] in {
        "best", "great", "excellent", "good", "brilliant", "book", "inaccuracy",
        "mistake", "blunder", "miss",
    }
```

with:

```python
    assert state["lastMove"]["best"]["uci"] == "e2e4"
    assert state["lastMove"]["best"]["san"] == "e4"
    assert state["lastMove"]["played"]["san"] == "e4"
    assert state["lastMove"]["classification"]["label"] in {
        "best", "great", "excellent", "good", "brilliant", "book", "inaccuracy",
        "mistake", "blunder", "miss",
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py::test_make_move_classifies_using_prior_analysis -v`
Expected: FAIL — `KeyError: 'best'` (payload still has the old `{uci, classification}` shape).

- [ ] **Step 3: Change `_on_update` to call the helper**

In `chessmenthol/server/orchestrator.py`, inside `_on_update`, replace:

```python
                c = classify_move(board_before, move, before_a, analysis)
                self._last_move = {
                    "uci": move.uci(),
                    "classification": serialize.classification_to_dict(c),
                }
```

with:

```python
                c = classify_move(board_before, move, before_a, analysis)
                self._last_move = serialize.last_move_to_dict(
                    c, board_before, move, before_a, analysis)
```

- [ ] **Step 4: Run the orchestrator tests to verify they pass**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py -v`
Expected: PASS (all orchestrator tests).

- [ ] **Step 5: Run the full Python suite (no regressions)**

Run: `.venv/bin/pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add chessmenthol/server/orchestrator.py tests/server/test_orchestrator.py
git commit -m "feat(server): emit enriched lastMove (played vs best) payload"
```

---

## Task 3: Frontend — `figurine.ts` notation util

**Files:**
- Create: `frontend/src/lib/figurine.ts`
- Test: `frontend/src/tests/figurine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/figurine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toFigurine } from '../lib/figurine';

describe('toFigurine', () => {
  it('maps piece letters to filled glyphs', () => {
    expect(toFigurine('Nf3')).toBe('♞f3');
    expect(toFigurine('Bxc3')).toBe('♝xc3');
    expect(toFigurine('Qxd8+')).toBe('♛xd8+');
    expect(toFigurine('Rae1')).toBe('♜ae1');
    expect(toFigurine('Kf1')).toBe('♚f1');
  });

  it('leaves pawn moves without a glyph', () => {
    expect(toFigurine('bxc3')).toBe('bxc3'); // lowercase b = file, not bishop
    expect(toFigurine('e4')).toBe('e4');
    expect(toFigurine('exd5')).toBe('exd5');
  });

  it('passes castling through and converts promotion pieces', () => {
    expect(toFigurine('O-O')).toBe('O-O');
    expect(toFigurine('O-O-O')).toBe('O-O-O');
    expect(toFigurine('a8=Q')).toBe('a8=♛');
  });

  it('converts a full numbered variation string', () => {
    expect(toFigurine('16... O-O-O 17. Nd7 Bg3')).toBe('16... O-O-O 17. ♞d7 ♝g3');
    expect(toFigurine('1...e5 2. Nf3 Nc6 …')).toBe('1...e5 2. ♞f3 ♞c6 …');
  });

  it('returns empty string unchanged', () => {
    expect(toFigurine('')).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/figurine.test.ts`
Expected: FAIL — cannot resolve `../lib/figurine`.

- [ ] **Step 3: Implement the util**

Create `frontend/src/lib/figurine.ts`:

```ts
// Figurine notation: replace uppercase piece letters with the filled (black) unicode
// chess glyphs. SAN uses lowercase for files (a-h) and 'O' for castling, so a plain
// global replace of K/Q/R/B/N is safe and leaves pawn moves and castling untouched.
// Promotion suffixes (e.g. "=Q") convert too.
const GLYPH: Record<string, string> = {
  K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞',
};

export function toFigurine(san: string): string {
  return san.replace(/[KQRBN]/g, (ch) => GLYPH[ch]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/figurine.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/figurine.ts frontend/src/tests/figurine.test.ts
git commit -m "feat(frontend): add pure toFigurine notation util"
```

---

## Task 4: Frontend — `LastMove.svelte` component + widened types

**Files:**
- Modify: `frontend/src/lib/types.ts:6-7`
- Create: `frontend/src/components/LastMove.svelte`
- Test: `frontend/src/tests/LastMove.test.ts`

- [ ] **Step 1: Widen `LastMoveDto` in `frontend/src/lib/types.ts`**

Replace the current lines:

```ts
export interface ClassificationDto { label: string; cpl: number; isBest: boolean; }
export interface LastMoveDto { uci: string; classification: ClassificationDto; }
```

with:

```ts
export interface ClassificationDto { label: string; cpl: number; isBest: boolean; }
export interface LastMovePvDto { san: string; evalText: string; pv: string; }
export interface LastMoveDto {
  classification: ClassificationDto;
  played: LastMovePvDto;
  best: LastMovePvDto & { uci: string };
}
```

- [ ] **Step 2: Write the failing component tests**

Create `frontend/src/tests/LastMove.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LastMove from '../components/LastMove.svelte';

const notBest = {
  classification: { label: 'mistake', cpl: 276, isBest: false },
  played: { san: 'Nc3', evalText: '+5.03', pv: '16... bxc3' },
  best: { san: 'Nec5', uci: 'e6c5', evalText: '+2.27', pv: '16... O-O-O 17. Nd7 Bg3' },
};

const best = {
  classification: { label: 'best', cpl: 0, isBest: true },
  played: { san: 'Nec5', evalText: '+2.27', pv: '16... O-O-O 17. Nd7 Bg3' },
  best: { san: 'Nec5', uci: 'e6c5', evalText: '+2.27', pv: '16... O-O-O 17. Nd7 Bg3' },
};

describe('LastMove', () => {
  it('shows played and best rows when best was not played', () => {
    render(LastMove, { lastMove: notBest, onPlayBest: () => {} });
    const played = screen.getByTestId('row-played');
    expect(played.textContent).toContain('+5.03');
    expect(played.textContent).toContain('Nc3 is a mistake');
    const playBest = screen.getByTestId('play-best');
    expect(playBest.textContent).toContain('+2.27');
    expect(playBest.textContent).toContain('Nec5 is best');
    // continuation rendered with figurine glyphs (knight glyph, no pawn glyph)
    expect(playBest.textContent).toContain('♞d7');
  });

  it('clicking the best row calls onPlayBest with the best uci', async () => {
    const spy = vi.fn();
    render(LastMove, { lastMove: notBest, onPlayBest: spy });
    await fireEvent.click(screen.getByTestId('play-best'));
    expect(spy).toHaveBeenCalledWith('e6c5');
  });

  it('shows a single best row (no button) when the best move was played', () => {
    render(LastMove, { lastMove: best, onPlayBest: () => {} });
    expect(screen.getByTestId('row-best').textContent).toContain('Nec5 is best');
    expect(screen.queryByTestId('play-best')).toBeNull();
    expect(screen.queryByTestId('row-played')).toBeNull();
  });

  it('renders nothing without a last move', () => {
    render(LastMove, { lastMove: null, onPlayBest: () => {} });
    expect(screen.queryByTestId('lastmove')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/LastMove.test.ts`
Expected: FAIL — cannot resolve `../components/LastMove.svelte`.

- [ ] **Step 4: Implement `LastMove.svelte`**

Create `frontend/src/components/LastMove.svelte`:

```svelte
<script lang="ts">
  import type { LastMoveDto } from '../lib/types';
  import { toFigurine } from '../lib/figurine';

  export let lastMove: LastMoveDto | null = null;
  export let onPlayBest: (uci: string) => void = () => {};

  const PHRASE: Record<string, string> = {
    best: 'best', great: 'great', brilliant: 'brilliant', excellent: 'excellent',
    good: 'good', book: 'a book move', inaccuracy: 'an inaccuracy',
    mistake: 'a mistake', blunder: 'a blunder', miss: 'a miss',
  };
  const phraseFor = (label: string) => PHRASE[label] ?? label;

  // A function-local guard narrows `lastMove` cleanly (avoids svelte-check
  // complaining about a closure over the possibly-null prop in the template).
  function play() { if (lastMove) onPlayBest(lastMove.best.uci); }
</script>

{#if lastMove}
  <div class="lm" data-testid="lastmove">
    {#if lastMove.classification.isBest}
      <div class="row best" data-testid="row-best">
        <span class="eval">{lastMove.best.evalText}</span>
        <span class="ico good">✓</span>
        <span class="name">{lastMove.best.san} is best</span>
        {#if lastMove.best.pv}<span class="pv">{toFigurine(lastMove.best.pv)}</span>{/if}
      </div>
    {:else}
      <div class="row label-{lastMove.classification.label}" data-testid="row-played">
        <span class="eval">{lastMove.played.evalText}</span>
        <span class="ico bad">✗</span>
        <span class="name">{lastMove.played.san} is {phraseFor(lastMove.classification.label)}</span>
        {#if lastMove.played.pv}<span class="pv">{toFigurine(lastMove.played.pv)}</span>{/if}
      </div>
      <button class="row best" data-testid="play-best"
        title="Undo and play the best move"
        on:click={play}>
        <span class="eval">{lastMove.best.evalText}</span>
        <span class="ico good">✓</span>
        <span class="name">{lastMove.best.san} is best</span>
        {#if lastMove.best.pv}<span class="pv">{toFigurine(lastMove.best.pv)}</span>{/if}
      </button>
    {/if}
  </div>
{/if}

<style>
  .lm { display: flex; flex-direction: column; gap: 6px; }
  .row { display: grid; grid-template-columns: auto auto 1fr; align-items: center;
    gap: 8px; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.05);
    text-align: left; width: 100%; }
  button.row { font: inherit; color: inherit; border: 1px solid rgba(255,255,255,0.12);
    cursor: pointer; }
  button.row:hover { background: rgba(129,182,76,0.18); border-color: #81b64c; }
  .eval { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 13px;
    color: #e6e6e6; }
  .ico { font-weight: 700; }
  .ico.good { color: #81b64c; }
  .ico.bad { color: #e58f2a; }
  .name { font-size: 13px; }
  .pv { grid-column: 3; justify-self: start; font-size: 11px; opacity: 0.7;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    grid-row: 2; padding-left: 2px; }
  /* played-row accent colors mirror the old Badge label palette */
  .label-inaccuracy .ico.bad { color: #f7c631; }
  .label-mistake .ico.bad, .label-miss .ico.bad { color: #e58f2a; }
  .label-blunder .ico.bad { color: #fa412d; }
</style>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/LastMove.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/components/LastMove.svelte frontend/src/tests/LastMove.test.ts
git commit -m "feat(frontend): add LastMove played-vs-best panel and widen LastMoveDto"
```

---

## Task 5: Frontend — wire `App.svelte` and remove `Badge`

**Files:**
- Modify: `frontend/src/App.svelte:9,32,95`
- Delete: `frontend/src/components/Badge.svelte`, `frontend/src/tests/Badge.test.ts`

- [ ] **Step 1: Swap the import in `App.svelte`**

Replace:

```svelte
  import Badge from './components/Badge.svelte';
```

with:

```svelte
  import LastMove from './components/LastMove.svelte';
```

- [ ] **Step 2: Add the `playBest` handler**

In `App.svelte`, immediately after the existing `function onMove(...)` line:

```svelte
  function onMove(uci: string) { send({ type: 'make_move', uci }); }
```

add:

```svelte
  function playBest(uci: string) { send({ type: 'undo' }); send({ type: 'make_move', uci }); }
```

- [ ] **Step 3: Render `LastMove` in the "Last move" box**

Replace:

```svelte
        <Badge lastMove={s?.lastMove ?? null} />
```

with:

```svelte
        <LastMove lastMove={s?.lastMove ?? null} onPlayBest={playBest} />
```

- [ ] **Step 4: Delete the superseded Badge files**

```bash
git rm frontend/src/components/Badge.svelte frontend/src/tests/Badge.test.ts
```

- [ ] **Step 5: Type-check (catches the dropped `uci` field and prop wiring)**

Run: `cd frontend && npm run check`
Expected: PASS — no svelte-check/tsc errors. (The clickable best uses the `play()` handler from
Task 4, whose `if (lastMove)` guard narrows the prop, so no template closure-narrowing error arises.)

- [ ] **Step 6: Run the full frontend suite (no Badge references remain)**

Run: `cd frontend && npm run test`
Expected: PASS — all suites green; no "Cannot find module Badge" errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.svelte
git commit -m "feat(frontend): wire LastMove panel + clickable best, remove Badge"
```

---

## Final verification

- [ ] **Full Python suite:** `.venv/bin/pytest -q` → PASS
- [ ] **Full frontend suite:** `cd frontend && npm run test` → PASS
- [ ] **Frontend type-check:** `cd frontend && npm run check` → PASS
- [ ] **Manual smoke (optional):** run the app, make a deliberately bad move on the board, confirm
  the "Last move" box shows two rows (played ✗ with its eval + continuation, best ✓ green), and
  clicking the best row undoes the move and plays the best move (which then shows the single green
  "… is best" row).

---

## Notes for the implementer

- **Why no new server command for "play best":** `undo` then `make_move(bestUci)` reuse the existing,
  tested handlers. WebSocket messages are ordered and the orchestrator applies them sequentially
  under its lock, so the board lands on the pre-move position and then plays the best move (which
  re-classifies as "best"). The brief double analysis-restart on a single click is acceptable.
- **Eval point of view:** both rows show white-POV text via `Eval.format_white()` (`+5.03`,
  `+2.27`, or `#N` for mate) — consistent with the eval bar and Engine-lines panel.
- **Figurine scope:** only the continuation strings pass through `toFigurine`; move *names*
  (`played.san`, `best.san`) stay plain letters, and the Engine-lines panel is unchanged.
- **Truncation:** continuations show `PV_PLIES = 3` plies with a trailing ` …` when the real PV is
  longer; an empty PV renders as `""` (the component omits the `.pv` span).
