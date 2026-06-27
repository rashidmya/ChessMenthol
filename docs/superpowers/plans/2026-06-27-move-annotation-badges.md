# Move-quality Annotation Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an original filled-disc badge for each of the 10 `MoveClass` categories in the "Last move" panel and as a chess.com-style corner badge on the played move's destination square.

**Architecture:** A single pure data module (`glyphs.ts`) defines color + symbol per label; one presentational `MoveBadge.svelte` draws the filled-disc SVG and is reused in both placements; a pure `squareCorner` mapping plus a `BoardBadge.svelte` overlay positions the badge over chessground. The only backend change is exposing the played move's UCI in the `lastMove` payload.

**Tech Stack:** Svelte 5 + TypeScript + Vite (frontend, tested with Vitest + @testing-library/svelte); Python + python-chess (server, tested with pytest). No new dependencies.

---

## File Structure

**Server**
- Modify `chessmenthol/server/serialize.py` — add `played.uci` to the `last_move_to_dict` payload.
- Modify `tests/server/test_serialize.py` — assert the new field.

**Frontend — new files**
- `frontend/src/lib/glyphs.ts` — label → `{ kind, symbol, color }` (single source of truth).
- `frontend/src/components/MoveBadge.svelte` — filled-disc badge, reused everywhere.
- `frontend/src/lib/boardBadge.ts` — pure `squareCorner(square, orientation)`.
- `frontend/src/components/BoardBadge.svelte` — absolute overlay placing one badge on the board.
- Tests: `frontend/src/tests/glyphs.test.ts`, `MoveBadge.test.ts`, `boardBadge.test.ts`, `BoardBadge.test.ts`.

**Frontend — modified files**
- `frontend/src/components/LastMove.svelte` — use `MoveBadge`, drop the ad-hoc `✓`/`✗`/`!!` spans + their CSS.
- `frontend/src/tests/LastMove.test.ts` — assert badges by accessible name.
- `frontend/src/lib/types.ts` — add optional `uci` to `LastMovePvDto`.
- `frontend/src/App.svelte` — mount `BoardBadge` over the board.

**Conventions to follow**
- Run server tests from the repo root with `pytest` (the project venv is already active for the executor).
- Run frontend commands from `frontend/`: `npm test` (Vitest), `npm run check` (svelte-check + tsc), `npm run build`.
- Commit messages use the repo's conventional style (`feat(server):`, `feat(frontend):`, `test(...)`).

---

## Task 1: Server — expose the played move's UCI

**Files:**
- Modify: `chessmenthol/server/serialize.py` (the `played` dict inside `last_move_to_dict`, ~line 69)
- Test: `tests/server/test_serialize.py` (`test_last_move_to_dict_best_not_played` ~line 76, `test_last_move_to_dict_best_played_single` ~line 97)

- [ ] **Step 1: Update the tests to expect `played.uci`**

In `tests/server/test_serialize.py`, change the played-dict assertion in `test_last_move_to_dict_best_not_played` from:

```python
    assert d["played"] == {"san": "a3", "evalText": "+5.03", "pv": "1...e5 2. Nf3"}
```

to:

```python
    assert d["played"] == {"san": "a3", "uci": "a2a3", "evalText": "+5.03", "pv": "1...e5 2. Nf3"}
```

And in `test_last_move_to_dict_best_played_single`, add a UCI assertion right after the existing `d["played"]["evalText"]` line:

```python
    assert d["played"]["uci"] == "e2e4"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/server/test_serialize.py -q`
Expected: FAIL — the `played` dict has no `"uci"` key yet (`KeyError` / dict-inequality on `test_last_move_to_dict_best_not_played`).

- [ ] **Step 3: Add the `uci` field to the played payload**

In `chessmenthol/server/serialize.py`, in `last_move_to_dict`, change the `played` block from:

```python
        "played": {
            "san": board_before.san(move),
            "evalText": after_a.best.eval.format_white(),
            "pv": _continuation_san(after_played, after_a.best.pv, plies),
        },
```

to:

```python
        "played": {
            "san": board_before.san(move),
            "uci": move.uci(),
            "evalText": after_a.best.eval.format_white(),
            "pv": _continuation_san(after_played, after_a.best.pv, plies),
        },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/server/test_serialize.py -q`
Expected: PASS (all serialize tests green).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/server/serialize.py tests/server/test_serialize.py
git commit -m "feat(server): include played move uci in lastMove payload"
```

---

## Task 2: `glyphs.ts` — the badge data (single source of truth)

**Files:**
- Create: `frontend/src/lib/glyphs.ts`
- Test: `frontend/src/tests/glyphs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/glyphs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GLYPHS, glyphFor } from '../lib/glyphs';

// Mirror of chessmenthol/analysis/classify.py MoveClass values.
const MOVE_CLASSES = [
  'brilliant', 'great', 'best', 'excellent', 'good',
  'book', 'inaccuracy', 'mistake', 'blunder', 'miss',
];

describe('glyphs', () => {
  it('has a spec for every MoveClass value', () => {
    for (const label of MOVE_CLASSES) {
      expect(GLYPHS[label], label).toBeDefined();
    }
  });

  it('every spec has a 6-digit hex color', () => {
    for (const label of MOVE_CLASSES) {
      expect(GLYPHS[label].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('text-kind specs carry their symbol', () => {
    expect(GLYPHS.blunder).toEqual({ kind: 'text', symbol: '??', color: '#f7402d' });
    expect(GLYPHS.best.kind).toBe('star');
  });

  it('glyphFor returns a neutral fallback for an unknown label', () => {
    const f = glyphFor('not-a-real-label');
    expect(f.color).toBe('#8a8a8a');
    expect(f.kind).toBe('text');
  });

  it('glyphFor returns the mapped spec for a known label', () => {
    expect(glyphFor('brilliant')).toBe(GLYPHS.brilliant);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- glyphs`
Expected: FAIL — `../lib/glyphs` does not exist (import/resolve error).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/glyphs.ts`:

```ts
export type GlyphKind = 'text' | 'star' | 'thumb' | 'check' | 'cross' | 'book';

export interface GlyphSpec {
  kind: GlyphKind;
  /** Text glyph drawn when kind === 'text' (e.g. '!!'); '' for drawn kinds. */
  symbol: string;
  color: string;
}

/** Single source of truth for move-quality badge artwork, keyed by the backend
 *  MoveClass value (chessmenthol/analysis/classify.py). Colors/symbols live ONLY
 *  here — components read from this map, never hard-code their own. */
export const GLYPHS: Record<string, GlyphSpec> = {
  brilliant:  { kind: 'text',  symbol: '!!', color: '#1aa99c' },
  great:      { kind: 'text',  symbol: '!',  color: '#5a87b0' },
  best:       { kind: 'star',  symbol: '',   color: '#7cab3e' },
  excellent:  { kind: 'thumb', symbol: '',   color: '#95b94a' },
  good:       { kind: 'check', symbol: '',   color: '#b0b35c' },
  book:       { kind: 'book',  symbol: '',   color: '#a98863' },
  inaccuracy: { kind: 'text',  symbol: '?!', color: '#efbf3b' },
  mistake:    { kind: 'text',  symbol: '?',  color: '#e58f2a' },
  miss:       { kind: 'cross', symbol: '',   color: '#d76b3a' },
  blunder:    { kind: 'text',  symbol: '??', color: '#f7402d' },
};

/** Neutral fallback so an unexpected label never crashes the UI. */
const FALLBACK: GlyphSpec = { kind: 'text', symbol: '·', color: '#8a8a8a' };

export function glyphFor(label: string): GlyphSpec {
  return GLYPHS[label] ?? FALLBACK;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- glyphs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/glyphs.ts frontend/src/tests/glyphs.test.ts
git commit -m "feat(frontend): glyphs.ts move-quality badge spec (color + symbol per label)"
```

---

## Task 3: `MoveBadge.svelte` — the reusable filled-disc badge

**Files:**
- Create: `frontend/src/components/MoveBadge.svelte`
- Test: `frontend/src/tests/MoveBadge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/MoveBadge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MoveBadge from '../components/MoveBadge.svelte';

describe('MoveBadge', () => {
  it('renders an accessible svg with a capitalized default title', () => {
    const { getByRole } = render(MoveBadge, { label: 'blunder' });
    const svg = getByRole('img', { name: 'Blunder' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('fills the disc with the label color from glyphs', () => {
    const { container } = render(MoveBadge, { label: 'brilliant' });
    const disc = container.querySelector('circle');
    expect(disc?.getAttribute('fill')).toBe('#1aa99c');
  });

  it('honors a custom size and title', () => {
    const { getByRole } = render(MoveBadge, { label: 'best', size: 40, title: 'Best move' });
    const svg = getByRole('img', { name: 'Best move' });
    expect(svg.getAttribute('width')).toBe('40');
  });

  it('draws the text symbol for a text-kind label', () => {
    const { container } = render(MoveBadge, { label: 'blunder' });
    expect(container.textContent).toContain('??');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- MoveBadge`
Expected: FAIL — `../components/MoveBadge.svelte` does not exist.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/MoveBadge.svelte`. Inner symbols are drawn with native Svelte SVG markup (not `{@html}`) so they render correctly under jsdom and contribute their text to `textContent`:

```svelte
<script context="module" lang="ts">
  // Per-instance id source so multiple badges on one page never share a <defs> id.
  let _uid = 0;
</script>

<script lang="ts">
  import { glyphFor } from '../lib/glyphs';

  export let label: string;
  export let size = 20;
  export let title: string = label.charAt(0).toUpperCase() + label.slice(1);

  $: spec = glyphFor(label);
  $: isDouble = spec.symbol.length > 1;
  const gid = `mb-sheen-${++_uid}`;
</script>

<svg class="move-badge" width={size} height={size} viewBox="0 0 34 34"
     role="img" aria-label={title}>
  <defs>
    <radialGradient id={gid} cx="0.5" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#fff" stop-opacity="0.28" />
      <stop offset="0.6" stop-color="#fff" stop-opacity="0" />
    </radialGradient>
  </defs>
  <circle cx="17" cy="17" r="16" fill={spec.color} />
  <circle cx="17" cy="17" r="16" fill="url(#{gid})" />

  {#if spec.kind === 'text'}
    <text x="17" y="17.8" text-anchor="middle" dominant-baseline="middle"
          letter-spacing={isDouble ? -1 : 0}
          font-family="system-ui, sans-serif" font-weight="800"
          font-size={isDouble ? 17 : 18.5} fill="#fff">{spec.symbol}</text>
  {:else if spec.kind === 'check'}
    <path d="M10 17.5 l4.2 4.2 L24 11" fill="none" stroke="#fff"
          stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  {:else if spec.kind === 'cross'}
    <path d="M11 11 L23 23 M23 11 L11 23" fill="none" stroke="#fff"
          stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  {:else if spec.kind === 'star'}
    <path d="M17 7.5 l2.7 5.9 6.4 .7 -4.8 4.3 1.3 6.3 -5.6 -3.2 -5.6 3.2 1.3 -6.3 -4.8 -4.3 6.4 -.7 z"
          fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round" />
  {:else if spec.kind === 'book'}
    <path d="M17 11 C14.5 9.2 11 9 8.5 9.6 V24 C11 23.4 14.5 23.6 17 25 C19.5 23.6 23 23.4 25.5 24 V9.6 C23 9 19.5 9.2 17 11 Z M17 11 V25"
          fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  {:else if spec.kind === 'thumb'}
    <g transform="translate(6.5,6.7) scale(0.875)">
      <path fill="#fff" d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
    </g>
  {/if}
</svg>

<style>
  .move-badge {
    display: inline-block;
    vertical-align: middle;
    filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.35));
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- MoveBadge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MoveBadge.svelte frontend/src/tests/MoveBadge.test.ts
git commit -m "feat(frontend): MoveBadge filled-disc badge component"
```

---

## Task 4: Use `MoveBadge` in the Last-move panel

**Files:**
- Modify: `frontend/src/components/LastMove.svelte`
- Test: `frontend/src/tests/LastMove.test.ts`

- [ ] **Step 1: Update the test to assert badges by accessible name**

In `frontend/src/tests/LastMove.test.ts`, add a badge assertion to the brilliant test (it already imports `screen`). Change the brilliant test body from:

```ts
  it('shows a brilliant icon (not ✗) for a brilliant move that is not the engine top move', () => {
    render(LastMove, { lastMove: brilliant, onPlayBest: () => {} });
    const played = screen.getByTestId('row-played');
    expect(played.textContent).toContain('Bxh7+ is brilliant');
    expect(played.textContent).toContain('!!');
    expect(played.textContent).not.toContain('✗');
  });
```

to:

```ts
  it('shows a brilliant badge (not ✗) for a brilliant move that is not the engine top move', () => {
    render(LastMove, { lastMove: brilliant, onPlayBest: () => {} });
    const played = screen.getByTestId('row-played');
    expect(played.textContent).toContain('Bxh7+ is brilliant');
    expect(screen.getByRole('img', { name: 'Brilliant' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Best' })).toBeTruthy();
    expect(played.textContent).not.toContain('✗');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- LastMove`
Expected: FAIL — there is no element with role `img` / name `Brilliant` yet (the panel still renders a plain `!!` span).

- [ ] **Step 3: Update `LastMove.svelte` to render `MoveBadge`**

In `frontend/src/components/LastMove.svelte`:

1. Add the import after the existing `toFigurine` import:

```svelte
  import { toFigurine } from '../lib/figurine';
  import MoveBadge from './MoveBadge.svelte';
```

2. In the `isBest` row, replace:

```svelte
        <span class="eval">{lastMove.best.evalText}</span>
        <span class="ico good">✓</span>
        <span class="name">{lastMove.best.san} is best</span>
```

with:

```svelte
        <span class="eval">{lastMove.best.evalText}</span>
        <MoveBadge label="best" size={20} />
        <span class="name">{lastMove.best.san} is best</span>
```

3. In the played (non-best) row, replace the whole icon `{#if}` block:

```svelte
        <span class="eval">{lastMove.played.evalText}</span>
        {#if lastMove.classification.label === 'brilliant'}
          <span class="ico brilliant">!!</span>
        {:else}
          <span class="ico bad">✗</span>
        {/if}
        <span class="name">{lastMove.played.san} is {phraseFor(lastMove.classification.label)}</span>
```

with:

```svelte
        <span class="eval">{lastMove.played.evalText}</span>
        <MoveBadge label={lastMove.classification.label} size={20} />
        <span class="name">{lastMove.played.san} is {phraseFor(lastMove.classification.label)}</span>
```

4. In the clickable best button row, replace:

```svelte
        <span class="eval">{lastMove.best.evalText}</span>
        <span class="ico good">✓</span>
        <span class="name">{lastMove.best.san} is best</span>
```

with:

```svelte
        <span class="eval">{lastMove.best.evalText}</span>
        <MoveBadge label="best" size={20} />
        <span class="name">{lastMove.best.san} is best</span>
```

5. Delete the now-unused icon CSS rules from the `<style>` block (the color now lives in `glyphs.ts`). Remove these lines:

```css
  .ico { font-weight: 700; }
  .ico.good { color: #81b64c; }
  .ico.bad { color: #e58f2a; }
  .ico.brilliant { color: #1abc9c; }  /* a brilliant move can be non-best: teal !!, not ✗ */
```

and:

```css
  .label-inaccuracy .ico.bad { color: #f7c631; }
  .label-mistake .ico.bad, .label-miss .ico.bad { color: #e58f2a; }
  .label-blunder .ico.bad { color: #fa412d; }
```

(Leave the `.row`, `.eval`, `.name`, `.pv`, and `button.row` rules untouched. The `label-{...}` class on the played row may remain — it is now inert but harmless.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- LastMove`
Expected: PASS (all LastMove tests green, including the existing play-best and single-best-row tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/LastMove.svelte frontend/src/tests/LastMove.test.ts
git commit -m "feat(frontend): render MoveBadge in the Last-move panel"
```

---

## Task 5: `boardBadge.ts` — pure square → corner mapping

**Files:**
- Create: `frontend/src/lib/boardBadge.ts`
- Test: `frontend/src/tests/boardBadge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/boardBadge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { squareCorner } from '../lib/boardBadge';

describe('squareCorner (white at bottom)', () => {
  it('a8 (top-left square) → top-right corner (12.5, 0)', () => {
    expect(squareCorner('a8', 'white')).toEqual({ leftPct: 12.5, topPct: 0 });
  });
  it('h1 (bottom-right square) → top-right corner (100, 87.5)', () => {
    expect(squareCorner('h1', 'white')).toEqual({ leftPct: 100, topPct: 87.5 });
  });
  it('e5 → (62.5, 37.5)', () => {
    expect(squareCorner('e5', 'white')).toEqual({ leftPct: 62.5, topPct: 37.5 });
  });
});

describe('squareCorner (black at bottom)', () => {
  it('flips files and ranks: a8 → (100, 87.5)', () => {
    expect(squareCorner('a8', 'black')).toEqual({ leftPct: 100, topPct: 87.5 });
  });
  it('h1 → (12.5, 0)', () => {
    expect(squareCorner('h1', 'black')).toEqual({ leftPct: 12.5, topPct: 0 });
  });
  it('e5 → (50, 50)', () => {
    expect(squareCorner('e5', 'black')).toEqual({ leftPct: 50, topPct: 50 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- boardBadge`
Expected: FAIL — `../lib/boardBadge` does not exist.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/boardBadge.ts`:

```ts
export interface Corner { leftPct: number; topPct: number; }

/** Top-right corner of `square` (e.g. "e5") as percentages of board width/height,
 *  in the displayed frame for the given orientation. Matches the chessground layout:
 *  file a→h left→right and rank 8→1 top→bottom when White is at the bottom; both
 *  axes flip when Black is at the bottom. Pure — no DOM. */
export function squareCorner(square: string, orientation: 'white' | 'black'): Corner {
  const fileIdx = square.charCodeAt(0) - 97; // 'a' -> 0 ... 'h' -> 7
  const rankIdx = Number(square[1]) - 1;     // '1' -> 0 ... '8' -> 7
  const col = orientation === 'white' ? fileIdx : 7 - fileIdx;
  const row = orientation === 'white' ? 7 - rankIdx : rankIdx;
  return { leftPct: ((col + 1) / 8) * 100, topPct: (row / 8) * 100 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- boardBadge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/boardBadge.ts frontend/src/tests/boardBadge.test.ts
git commit -m "feat(frontend): squareCorner pure board-coordinate mapping"
```

---

## Task 6: `BoardBadge.svelte` — the on-board overlay

**Files:**
- Modify: `frontend/src/lib/types.ts` (add optional `uci` to `LastMovePvDto`)
- Create: `frontend/src/components/BoardBadge.svelte`
- Test: `frontend/src/tests/BoardBadge.test.ts`

- [ ] **Step 1: Add `uci` to the played-move type**

In `frontend/src/lib/types.ts`, change:

```ts
export interface LastMovePvDto { san: string; evalText: string; pv: string; }
```

to:

```ts
export interface LastMovePvDto { san: string; uci?: string; evalText: string; pv: string; }
```

(The server always sends `played.uci` now; `uci` is optional so existing `played` fixtures without it still type-check. `best` keeps its required `uci` via the existing `& { uci: string }` intersection.)

- [ ] **Step 2: Write the failing test**

Create `frontend/src/tests/BoardBadge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import BoardBadge from '../components/BoardBadge.svelte';

const lm = (label: string, uci: string) => ({
  classification: { label, cpl: 0, isBest: false },
  played: { san: 'Nf3', uci, evalText: '+0.2', pv: '' },
  best: { san: 'Nf3', uci, evalText: '+0.2', pv: '' },
});

describe('BoardBadge', () => {
  it('renders nothing without a last move', () => {
    const { queryByTestId } = render(BoardBadge, { lastMove: null, orientation: 'white' });
    expect(queryByTestId('board-badge')).toBeNull();
  });

  it('anchors the badge at the destination square top-right corner (white)', () => {
    const { getByTestId } = render(BoardBadge, { lastMove: lm('blunder', 'g1f3'), orientation: 'white' });
    const anchor = getByTestId('board-badge');
    // f3 → col 5, row 5 → top-right (6/8, 5/8) = 75%, 62.5%
    expect(anchor.style.left).toBe('75%');
    expect(anchor.style.top).toBe('62.5%');
  });

  it('flips with board orientation (black at bottom)', () => {
    const { getByTestId } = render(BoardBadge, { lastMove: lm('blunder', 'g1f3'), orientation: 'black' });
    const anchor = getByTestId('board-badge');
    // f3 black → col 2, row 2 → (3/8, 2/8) = 37.5%, 25%
    expect(anchor.style.left).toBe('37.5%');
    expect(anchor.style.top).toBe('25%');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npm test -- BoardBadge`
Expected: FAIL — `../components/BoardBadge.svelte` does not exist.

- [ ] **Step 4: Write the implementation**

Create `frontend/src/components/BoardBadge.svelte`. The badge size is computed from the layer's own measured width (one square = width / 8), so it tracks board resizes; the layer fills its positioned parent and ignores pointer events:

```svelte
<script lang="ts">
  import MoveBadge from './MoveBadge.svelte';
  import { squareCorner } from '../lib/boardBadge';
  import type { LastMoveDto } from '../lib/types';

  export let lastMove: LastMoveDto | null = null;
  export let orientation: 'white' | 'black' = 'white';

  let width = 0; // overlay width in px; one square = width / 8

  // Destination square = UCI chars 3-4 (handles promotion 'e7e8q' and castling 'e1g1').
  $: dest = lastMove?.played.uci ? lastMove.played.uci.slice(2, 4) : null;
  $: corner = dest ? squareCorner(dest, orientation) : null;
  $: badgeSize = (width / 8) * 0.46;
</script>

<div class="board-badge-layer" bind:clientWidth={width} aria-hidden="true">
  {#if lastMove && corner}
    <div class="anchor" data-testid="board-badge"
         style="left:{corner.leftPct}%; top:{corner.topPct}%">
      <MoveBadge label={lastMove.classification.label} size={badgeSize} />
    </div>
  {/if}
</div>

<style>
  .board-badge-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
  .anchor { position: absolute; transform: translate(-50%, -50%); }
</style>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test -- BoardBadge`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/components/BoardBadge.svelte frontend/src/tests/BoardBadge.test.ts
git commit -m "feat(frontend): BoardBadge overlay positions the badge on the played square"
```

---

## Task 7: Wire `BoardBadge` into the board in `App.svelte`

**Files:**
- Modify: `frontend/src/App.svelte` (import, the `.board-wrap` markup ~line 85, the `.board-wrap` CSS ~line 134)

- [ ] **Step 1: Import `BoardBadge`**

In `frontend/src/App.svelte`, add the import next to the existing `Board` import (after `import Board from './components/Board.svelte';`):

```svelte
  import Board from './components/Board.svelte';
  import BoardBadge from './components/BoardBadge.svelte';
```

- [ ] **Step 2: Mount the overlay inside `.board-wrap`**

Change the `.board-wrap` block from:

```svelte
        <div class="board-wrap">
          <Board bind:this={boardComp} {fen} {orientation} {onMove} revertSignal={$errorSeq}
            lines={s?.lines ?? []} {showArrows} {editing} {selectedEditPiece} />
        </div>
```

to:

```svelte
        <div class="board-wrap">
          <Board bind:this={boardComp} {fen} {orientation} {onMove} revertSignal={$errorSeq}
            lines={s?.lines ?? []} {showArrows} {editing} {selectedEditPiece} />
          <BoardBadge lastMove={s?.lastMove ?? null} {orientation} />
        </div>
```

- [ ] **Step 3: Make `.board-wrap` the positioning context**

In the `<style>` block, change:

```css
  .board-wrap { width: min(60vh, 560px); flex: 0 0 auto; }
```

to:

```css
  .board-wrap { width: min(60vh, 560px); flex: 0 0 auto; position: relative; }
```

- [ ] **Step 4: Type-check, test, and build the frontend**

Run: `cd frontend && npm run check && npm test && npm run build`
Expected: svelte-check reports no errors; all Vitest suites pass (including `smoke`, `Controls`, `LastMove`, `MoveBadge`, `boardBadge`, `BoardBadge`, `glyphs`); the production build completes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.svelte
git commit -m "feat(frontend): overlay move-quality badge on the played square"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire server test suite**

Run: `pytest -q`
Expected: PASS (no regressions; `tests/server/test_serialize.py` includes the new `played.uci` assertions).

- [ ] **Step 2: Run the entire frontend suite + type check + build**

Run: `cd frontend && npm run check && npm test && npm run build`
Expected: all green; production build succeeds.

- [ ] **Step 3 (manual, optional): Visual smoke test**

If a dev environment is available, start the app, trigger a classified move, and confirm: (a) the panel shows the new filled-disc badge for the played move and a green star "best" badge, and (b) a matching badge sits at the top-right corner of the played move's destination square, flipping correctly when the board is flipped. No automated step; record the result in the task notes.

---

## Self-Review Notes (for the planner)

- **Spec coverage:** §1 overview → Tasks 2–7; §2 style/symbols/palette → `glyphs.ts` (Task 2) + `MoveBadge` (Task 3); panel placement (§3) → Task 4; board overlay technique, `squareCorner`, size 46%, all-10 categories (§2–§3) → Tasks 5–7; server `played.uci` (§3–§4) → Task 1; `LastMovePvDto.uci` (§4) → Task 6; error handling/edge cases (§5: unknown label fallback, null lastMove, promotion/castling slice, isBest, unique gradient id) → Tasks 2/3/6; testing (§6) → tests in every task; packaging (§7) → no new deps/assets, confirmed by `npm run build` in Tasks 7–8.
- **Placeholders:** none — every code/test step is complete.
- **Type/name consistency:** `GLYPHS`/`glyphFor`/`GlyphSpec`/`GlyphKind` (Task 2) used verbatim in Tasks 3; `squareCorner`/`Corner` (Task 5) used in Task 6; `MoveBadge` prop names `label`/`size`/`title` consistent across Tasks 3/4/6; `BoardBadge` props `lastMove`/`orientation` consistent across Tasks 6/7; `played.uci` field name consistent across Tasks 1/6.
