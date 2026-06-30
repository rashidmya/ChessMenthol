# Home / Analysis / Edit Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single right-hand panel into three screens — Home (start), Analysis, and Edit Board — that share one board, removing the Source/Position rows from Analysis and adding a Home start panel and a screenshot-parity board editor.

**Architecture:** A `screen: 'home' | 'analysis' | 'edit'` state in `App.svelte` drives which panel renders in the right column; the board column is shared. New presentational components `HomePanel` and `EditPanel` carry the new UI; `App.svelte` owns all navigation/engine side effects. `SourceControls` and `PositionControls` are deleted (capture folds into Home + the existing `RegionOverlay`; FEN/edit fold into Home + the editor). No backend/`Command` changes — every transition uses commands that already exist (`set_fen`, `set_turn`, `set_region`, `capture_now`, `request_region_shot`, `reset`, `set_analysis_enabled`, `make_move`).

**Tech Stack:** Svelte 4 (runes off), TypeScript, Vitest + @testing-library/svelte, chessground, Tauri (desktop-only capture).

**Working directory:** `/home/buga/Dev/ChessMenthol/frontend`. All test commands run from there.

**Conventions to follow:**
- Theme tokens live in `src/app.css` (`--paper`, `--ink`, `--green`, `--keyline`, etc.); button sizing follows mockup v3 (generous padding).
- Tests: `import { render, fireEvent } from '@testing-library/svelte'`, props-and-callbacks style (see `src/tests/PositionControls.test.ts`).
- Run a single test file: `npx vitest run src/tests/<file>.test.ts`.
- Commit after each task. The repo convention is to stack commits on `feat/svelte-tauri-migration` (do not merge).

---

## Transitions reference (single source of truth)

| From | Trigger | To | Commands sent (in order) |
|------|---------|----|--------------------------|
| home | Set Up Position | edit | — (enter edit mode locally) |
| home | Explore | analysis | `set_analysis_enabled{true}` |
| home | Start Analysis (text non-empty) | analysis | `set_fen{text.trim()}`, `set_analysis_enabled{true}` |
| home | Start Analysis (text empty) | analysis | `set_analysis_enabled{true}` |
| home | move a piece | analysis | `set_analysis_enabled{true}`, `make_move{uci}` |
| home | Capture Board (desktop) | analysis | `request_region_shot` → overlay → `set_region{…}`, `capture_now`, `set_analysis_enabled{true}` |
| edit | ← Back | home | — (board re-syncs to server fen, discarding edits) |
| edit | Load | analysis | `set_fen{builtFen}`, `set_analysis_enabled{true}` |
| analysis | ↩ New | home | `set_analysis_enabled{false}`, `reset` |

---

## Task 1: `buildFen` explicit castling + `castleFromFen`

**Files:**
- Modify: `frontend/src/lib/edit.ts`
- Test: `frontend/src/tests/edit.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/tests/edit.test.ts`:

```ts
import { buildFen, kingCountOk, pieceFromToken, coordsToKey, castleFromFen } from '../lib/edit';

describe('buildFen with explicit castling rights', () => {
  it('honors an explicit castling object over inference', () => {
    // start placement infers KQkq, but we force only white kingside
    expect(buildFen(START, 'white', { K: true, Q: false, k: false, q: false }))
      .toBe(`${START} w K - 0 1`);
  });
  it('emits - when all rights are false', () => {
    expect(buildFen(START, 'black', { K: false, Q: false, k: false, q: false }))
      .toBe(`${START} b - - 0 1`);
  });
  it('orders rights KQkq', () => {
    expect(buildFen(START, 'white', { K: true, Q: true, k: true, q: true }))
      .toBe(`${START} w KQkq - 0 1`);
  });
  it('still infers castling when no rights object is passed', () => {
    expect(buildFen(START, 'white')).toBe(`${START} w KQkq - 0 1`);
  });
});

describe('castleFromFen', () => {
  it('parses a full castling field', () => {
    expect(castleFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'))
      .toEqual({ K: true, Q: true, k: true, q: true });
  });
  it('parses a partial field', () => {
    expect(castleFromFen('r3k2r/8/8/8/8/8/8/R3K2R w Kq - 0 1'))
      .toEqual({ K: true, Q: false, k: false, q: true });
  });
  it('parses a dash as no rights', () => {
    expect(castleFromFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1'))
      .toEqual({ K: false, Q: false, k: false, q: false });
  });
  it('defaults to no rights when the field is missing', () => {
    expect(castleFromFen('4k3/8/8/8/8/8/8/4K3'))
      .toEqual({ K: false, Q: false, k: false, q: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/edit.test.ts`
Expected: FAIL — `castleFromFen` is not exported; `buildFen` ignores the 3rd argument.

- [ ] **Step 3: Implement** — in `src/lib/edit.ts`, add the `CastlingRights` type, extend `buildFen`, and add `castleFromFen`. Replace the existing `buildFen` with this version:

```ts
export interface CastlingRights { K: boolean; Q: boolean; k: boolean; q: boolean; }

/** Read the castling field (3rd token) of a FEN into explicit booleans. */
export function castleFromFen(fen: string): CastlingRights {
  const field = fen.split(' ')[1 + 1] ?? '-'; // token index 2 = castling
  return {
    K: field.includes('K'), Q: field.includes('Q'),
    k: field.includes('k'), q: field.includes('q'),
  };
}

/** Assemble a full FEN: side from the argument, en-passant '-', counters '0 1'.
 *  Castling is taken from `rights` when given, else inferred from king/rook home squares. */
export function buildFen(
  placement: string,
  sideToMove: 'white' | 'black',
  rights?: CastlingRights,
): string {
  const g = parsePlacement(placement);
  const at = (row: number, col: number): string | null => g[row]?.[col] ?? null;
  let castle = '';
  if (rights) {
    if (rights.K) castle += 'K';
    if (rights.Q) castle += 'Q';
    if (rights.k) castle += 'k';
    if (rights.q) castle += 'q';
  } else {
    // rank 1 row = g[7], rank 8 row = g[0]; files a..h = cols 0..7.
    const wK = at(7, 4) === 'K';
    const bK = at(0, 4) === 'k';
    if (wK && at(7, 7) === 'R') castle += 'K';
    if (wK && at(7, 0) === 'R') castle += 'Q';
    if (bK && at(0, 7) === 'r') castle += 'k';
    if (bK && at(0, 0) === 'r') castle += 'q';
  }
  if (castle === '') castle = '-';
  const turn = sideToMove === 'white' ? 'w' : 'b';
  return `${placement} ${turn} ${castle} - 0 1`;
}
```

(Note: `field = fen.split(' ')[2]` is written as `[1 + 1]` only to avoid a lint about magic numbers if present — use `[2]` if the linter is fine with it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/edit.test.ts`
Expected: PASS (all existing + new cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/edit.ts src/tests/edit.test.ts
git commit -m "feat(edit): buildFen accepts explicit castling rights + castleFromFen"
```

---

## Task 2: ActionBar — bigger nav buttons + bottom "New" action

**Files:**
- Modify: `frontend/src/components/ActionBar.svelte`
- Test: `frontend/src/tests/ActionBar.test.ts`

- [ ] **Step 1: Write the failing test** — append a case to `src/tests/ActionBar.test.ts`:

```ts
it('emits onNew when the New action is clicked', async () => {
  const onNew = vi.fn();
  const { getByText } = render(ActionBar, { props: { currentPly: 0, total: 0, onNavigate: vi.fn(), onNew } });
  await fireEvent.click(getByText('New'));
  expect(onNew).toHaveBeenCalled();
});
```

(Add `fireEvent` to the existing import line: `import { render, fireEvent } from '@testing-library/svelte';`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/tests/ActionBar.test.ts`
Expected: FAIL — no element with text "New".

- [ ] **Step 3: Implement** — replace `src/components/ActionBar.svelte` with:

```svelte
<script lang="ts">
  export let currentPly: number = 0;
  export let total: number = 0;
  export let onNavigate: (ply: number) => void = () => {};
  export let onNew: () => void = () => {};
</script>

<div class="nav">
  <button type="button" class="navbtn" title="First move"
    on:click={() => onNavigate(0)}>«</button>
  <button type="button" class="navbtn" title="Previous move"
    on:click={() => onNavigate(currentPly - 1)}>‹</button>
  <button type="button" class="navbtn" title="Next move"
    on:click={() => onNavigate(currentPly + 1)}>›</button>
  <button type="button" class="navbtn" title="Last move"
    on:click={() => onNavigate(total)}>»</button>
</div>
<div class="acts">
  <button type="button" class="act" on:click={onNew}><span class="ic">↩</span>New</button>
</div>

<style>
  .nav { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
  .navbtn {
    flex: 1; display: grid; place-items: center; height: 50px;
    font-family: var(--serif); font-size: 24px; color: var(--ink-2);
    background: var(--paper-2); border: 1px solid var(--keyline-2); border-radius: 10px;
    cursor: pointer; transition: .15s; line-height: 1;
  }
  .navbtn:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .acts { display: flex; justify-content: center; padding: 4px 12px 14px; }
  .act {
    display: flex; align-items: center; gap: 8px; padding: 10px 18px;
    font-family: var(--sans); font-weight: 600; font-size: 13.5px; color: var(--ink-2);
    background: transparent; border: none; border-radius: 9px; cursor: pointer; transition: .14s;
  }
  .act:hover { color: var(--green); background: var(--paper-2); }
  .act .ic { font-size: 15px; }
</style>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/tests/ActionBar.test.ts`
Expected: PASS (existing nav test + new "New" test).

- [ ] **Step 5: Commit**

```bash
git add src/components/ActionBar.svelte src/tests/ActionBar.test.ts
git commit -m "feat(ui): enlarge ActionBar nav + add bottom New action"
```

---

## Task 3: Board — `onEdit` callback + `setPlacement()` method

**Files:**
- Modify: `frontend/src/components/Board.svelte`
- Test: `frontend/src/tests/Board.test.ts`

Why: the editor needs (a) to be told the placement after each free edit so the FEN field stays live, and (b) a way to set the board to start/empty during edit (the existing `$: if (cg && !editing) cg.set({ fen })` deliberately ignores `fen` while editing).

- [ ] **Step 1: Write the failing test** — append to `src/tests/Board.test.ts`:

```ts
it('exposes setPlacement and accepts an onEdit prop without throwing', () => {
  const onEdit = () => {};
  const { component } = render(Board, {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    orientation: 'white', editing: true, selectedEditPiece: 'P', onEdit,
  } as any);
  // setPlacement is a no-op when chessground failed to init (jsdom), but must exist and not throw.
  expect(typeof (component as any).setPlacement).toBe('function');
  (component as any).setPlacement('8/8/8/8/8/8/8/8');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/tests/Board.test.ts`
Expected: FAIL — `setPlacement` is undefined.

- [ ] **Step 3: Implement** — in `src/components/Board.svelte`:

  a. Add the prop after `selectedEditPiece` (line ~21):
```ts
  /** Called with the new placement field after each free edit (palette/right-click). */
  export let onEdit: (placement: string) => void = () => {};
```

  b. Add an exported method next to `getPlacement` (after line ~30):
```ts
  /** Force the board to a placement even while editing (used by reset/clear). */
  export function setPlacement(placement: string): void {
    cg?.set({ fen: placement });
  }
```

  c. In `editPlace`, after `cg.setPieces(...)`, notify the parent:
```ts
  function editPlace(key: string): void {
    if (!cg || !editing || !selectedEditPiece) return;
    const piece = selectedEditPiece === 'trash' ? undefined : pieceFromToken(selectedEditPiece);
    cg.setPieces(new Map([[key as any, piece as any]]));
    onEdit(cg.getFen());
  }
```

  d. In `onContextMenu`, after the removal `cg.setPieces(...)`, notify the parent:
```ts
    cg.setPieces(new Map([[key as any, undefined as any]]));
    onEdit(cg.getFen());
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/tests/Board.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Board.svelte src/tests/Board.test.ts
git commit -m "feat(board): onEdit notify + setPlacement for editor live-sync/reset"
```

---

## Task 4: HomePanel component

**Files:**
- Create: `frontend/src/components/HomePanel.svelte`
- Test: `frontend/src/tests/HomePanel.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/tests/HomePanel.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import HomePanel from '../components/HomePanel.svelte';

describe('HomePanel', () => {
  it('renders the start controls and hides Capture without native capture', () => {
    const { getByText, queryByText } = render(HomePanel, { props: { hasCapture: false } });
    expect(getByText('Set Up Position')).toBeTruthy();
    expect(getByText('Explore')).toBeTruthy();
    expect(getByText('Start Analysis')).toBeTruthy();
    expect(queryByText('Capture Board')).toBeNull();
  });

  it('shows Capture Board when hasCapture is true', () => {
    const { getByText } = render(HomePanel, { props: { hasCapture: true } });
    expect(getByText('Capture Board')).toBeTruthy();
  });

  it('fires navigation callbacks', async () => {
    const onSetUp = vi.fn(), onExplore = vi.fn(), onCapture = vi.fn();
    const { getByText } = render(HomePanel, {
      props: { hasCapture: true, onSetUp, onExplore, onCapture },
    });
    await fireEvent.click(getByText('Set Up Position')); expect(onSetUp).toHaveBeenCalled();
    await fireEvent.click(getByText('Explore')); expect(onExplore).toHaveBeenCalled();
    await fireEvent.click(getByText('Capture Board')); expect(onCapture).toHaveBeenCalled();
  });

  it('passes the textarea text to onStart', async () => {
    const onStart = vi.fn();
    const { getByText, getByPlaceholderText } = render(HomePanel, { props: { onStart } });
    await fireEvent.input(getByPlaceholderText(/Paste your FEN/), {
      target: { value: '8/8/8/8/8/8/8/8 w - - 0 1' },
    });
    await fireEvent.click(getByText('Start Analysis'));
    expect(onStart).toHaveBeenCalledWith('8/8/8/8/8/8/8/8 w - - 0 1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/tests/HomePanel.test.ts`
Expected: FAIL — module `../components/HomePanel.svelte` not found.

- [ ] **Step 3: Implement** — create `src/components/HomePanel.svelte`:

```svelte
<script lang="ts">
  export let hasCapture = false;
  export let onSetUp: () => void = () => {};
  export let onExplore: () => void = () => {};
  export let onCapture: () => void = () => {};
  export let onStart: (text: string) => void = () => {};
  let input = '';
</script>

<div class="home" data-testid="home-panel">
  <div class="pbar"><span class="ptitle">Start</span></div>
  <div class="body">
    <button type="button" class="hbtn" on:click={onSetUp}><span class="ic">♟</span>Set Up Position</button>
    <button type="button" class="hbtn" on:click={onExplore}><span class="ic">🧭</span>Explore</button>
    {#if hasCapture}
      <button type="button" class="hbtn cap" on:click={onCapture}><span class="ic">📷</span>Capture Board</button>
    {/if}
    <textarea class="area" bind:value={input}
      placeholder="Paste your FEN, PGN(s), or drag & drop a PGN file here."></textarea>
    <button type="button" class="primary" on:click={() => onStart(input)}>Start Analysis</button>
  </div>
</div>

<style>
  .home {
    background: var(--card); border: 1px solid var(--keyline); border-radius: 8px;
    box-shadow: 0 1px 0 #fff inset, 0 12px 30px -24px rgba(40,30,15,.45);
    display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;
  }
  .pbar { padding: 11px 16px; border-bottom: 1px solid var(--keyline); }
  .ptitle { font-family: var(--mono); font-size: 10px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--ink-2); font-weight: 700; }
  .body { padding: 18px 16px; display: flex; flex-direction: column; }
  .hbtn {
    width: 100%; display: flex; align-items: center; justify-content: center; gap: 13px;
    padding: 19px 16px; margin-bottom: 12px; font-family: var(--sans); font-weight: 600;
    font-size: 15.5px; color: var(--ink-2); background: var(--paper-2);
    border: 1px solid var(--keyline-2); border-radius: 10px; cursor: pointer; transition: .14s;
  }
  .hbtn:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .hbtn .ic { font-size: 19px; }
  .hbtn.cap { border-style: dashed; }
  .area {
    width: 100%; min-height: 150px; resize: vertical; margin: 6px 0 14px; padding: 14px;
    border: 1px solid var(--keyline-2); border-radius: 10px; background: #fff;
    color: var(--ink-2); font-family: var(--mono); font-size: 12px;
  }
  .area::placeholder { color: var(--ink-faint); }
  .area:focus { outline: none; border-color: var(--green); box-shadow: 0 0 0 3px rgba(47,93,58,.12); }
  .primary {
    width: 100%; padding: 18px; border: none; border-radius: 10px; background: var(--green);
    color: #fff; font-family: var(--sans); font-weight: 700; font-size: 16px; cursor: pointer; transition: .14s;
  }
  .primary:hover { background: var(--green-soft); }
</style>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/tests/HomePanel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/HomePanel.svelte src/tests/HomePanel.test.ts
git commit -m "feat(ui): HomePanel start screen (Set Up / Explore / Capture / FEN / Start)"
```

---

## Task 5: EditPanel component

**Files:**
- Create: `frontend/src/components/EditPanel.svelte`
- Test: `frontend/src/tests/EditPanel.test.ts`

EditPanel is a presentational form: it renders the palette (reusing `EditPalette`), side-to-move `<select>`, flip/reset/clear icon buttons, castling checkboxes, the FEN input, a (read-only, parity-only) PGN box, and Load. It owns no state — `App.svelte` passes values and receives granular callbacks.

- [ ] **Step 1: Write the failing test** — create `src/tests/EditPanel.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import EditPanel from '../components/EditPanel.svelte';

const base = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  side: 'white' as const,
  castle: { K: true, Q: true, k: true, q: true },
  selected: 'P',
};

describe('EditPanel', () => {
  it('renders palette, side select, FEN value, and Load', () => {
    const { getByTestId, getByText, getByDisplayValue } = render(EditPanel, { props: base });
    expect(getByTestId('edit-palette')).toBeTruthy();
    expect(getByTestId('side-select')).toBeTruthy();
    expect(getByDisplayValue(base.fen)).toBeTruthy();
    expect(getByText('Load')).toBeTruthy();
  });

  it('emits onSide(false) when switched to Black to move', async () => {
    const onSide = vi.fn();
    const { getByTestId } = render(EditPanel, { props: { ...base, onSide } });
    await fireEvent.change(getByTestId('side-select'), { target: { value: 'black' } });
    expect(onSide).toHaveBeenCalledWith(false);
  });

  it('emits onToggleCastle for a castling checkbox', async () => {
    const onToggleCastle = vi.fn();
    const { getByTestId } = render(EditPanel, { props: { ...base, onToggleCastle } });
    await fireEvent.click(getByTestId('castle-K'));
    expect(onToggleCastle).toHaveBeenCalledWith('K');
  });

  it('emits onFenInput when the FEN field is edited', async () => {
    const onFenInput = vi.fn();
    const { getByTestId } = render(EditPanel, { props: { ...base, onFenInput } });
    await fireEvent.input(getByTestId('edit-fen'), { target: { value: '8/8/8/8/8/8/8/8 w - - 0 1' } });
    expect(onFenInput).toHaveBeenCalledWith('8/8/8/8/8/8/8/8 w - - 0 1');
  });

  it('emits onFlip / onReset / onClear / onLoad / onBack', async () => {
    const fns = { onFlip: vi.fn(), onReset: vi.fn(), onClear: vi.fn(), onLoad: vi.fn(), onBack: vi.fn() };
    const { getByTestId, getByText } = render(EditPanel, { props: { ...base, ...fns } });
    await fireEvent.click(getByTestId('edit-flip')); expect(fns.onFlip).toHaveBeenCalled();
    await fireEvent.click(getByTestId('edit-reset')); expect(fns.onReset).toHaveBeenCalled();
    await fireEvent.click(getByTestId('edit-clear')); expect(fns.onClear).toHaveBeenCalled();
    await fireEvent.click(getByText('Load')); expect(fns.onLoad).toHaveBeenCalled();
    await fireEvent.click(getByTestId('edit-back')); expect(fns.onBack).toHaveBeenCalled();
  });

  it('shows an edit error when provided', () => {
    const { getByText } = render(EditPanel, { props: { ...base, editError: 'Need exactly one white and one black king.' } });
    expect(getByText('Need exactly one white and one black king.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/tests/EditPanel.test.ts`
Expected: FAIL — module `../components/EditPanel.svelte` not found.

- [ ] **Step 3: Implement** — create `src/components/EditPanel.svelte`:

```svelte
<script lang="ts">
  import EditPalette from './EditPalette.svelte';
  import type { CastlingRights } from '../lib/edit';

  export let fen = '';
  export let side: 'white' | 'black' = 'white';
  export let castle: CastlingRights = { K: true, Q: true, k: true, q: true };
  export let selected: string | null = 'P';
  export let pgn = '';
  export let editError: string | null = null;
  export let onSelect: (tok: string) => void = () => {};
  export let onSide: (white: boolean) => void = () => {};
  export let onToggleCastle: (key: keyof CastlingRights) => void = () => {};
  export let onFlip: () => void = () => {};
  export let onReset: () => void = () => {};
  export let onClear: () => void = () => {};
  export let onFenInput: (text: string) => void = () => {};
  export let onLoad: () => void = () => {};
  export let onBack: () => void = () => {};
</script>

<div class="edit" data-testid="edit-panel">
  <div class="pbar">
    <button type="button" class="back" data-testid="edit-back" aria-label="Back" on:click={onBack}>←</button>
    <span class="ptitle">Set Up Position</span>
  </div>
  <div class="body">
    <EditPalette {selected} {onSelect} />

    <div class="row">
      <select class="sel" data-testid="side-select" value={side}
        on:change={(e) => onSide((e.currentTarget as HTMLSelectElement).value === 'white')}>
        <option value="white">White to move</option>
        <option value="black">Black to move</option>
      </select>
      <button type="button" class="ico" data-testid="edit-flip" title="Flip board" on:click={onFlip}>⇄</button>
      <button type="button" class="ico" data-testid="edit-reset" title="Start position" on:click={onReset}>↺</button>
      <button type="button" class="ico" data-testid="edit-clear" title="Clear board" on:click={onClear}>🗑</button>
    </div>

    <div class="castle">
      <div class="col">
        <div class="lab">White</div>
        <label class="ck"><input type="checkbox" data-testid="castle-K" checked={castle.K} on:change={() => onToggleCastle('K')} /> O-O</label>
        <label class="ck"><input type="checkbox" data-testid="castle-Q" checked={castle.Q} on:change={() => onToggleCastle('Q')} /> O-O-O</label>
      </div>
      <div class="col">
        <div class="lab">Black</div>
        <label class="ck"><input type="checkbox" data-testid="castle-k" checked={castle.k} on:change={() => onToggleCastle('k')} /> O-O</label>
        <label class="ck"><input type="checkbox" data-testid="castle-q" checked={castle.q} on:change={() => onToggleCastle('q')} /> O-O-O</label>
      </div>
    </div>

    <input class="fen" data-testid="edit-fen" value={fen} spellcheck="false"
      on:input={(e) => onFenInput((e.currentTarget as HTMLInputElement).value)} />

    <textarea class="pgn" data-testid="edit-pgn" readonly value={pgn}
      placeholder={'[Event "?"]\n[Site "?"]\n[Date "????.??.??"]\n[Round "?"]\n[White "?"]\n[Black "?"]\n[Result "*"]'}></textarea>

    {#if editError}<div class="err" role="alert" data-testid="edit-error">{editError}</div>{/if}
    <button type="button" class="primary" on:click={onLoad}>Load</button>
  </div>
</div>

<style>
  .edit {
    background: var(--card); border: 1px solid var(--keyline); border-radius: 8px;
    box-shadow: 0 1px 0 #fff inset, 0 12px 30px -24px rgba(40,30,15,.45);
    display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;
  }
  .pbar { display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-bottom: 1px solid var(--keyline); }
  .back { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--keyline-2);
    border-radius: 8px; background: var(--paper-2); color: var(--ink-2); font-size: 16px; cursor: pointer; transition: .14s; }
  .back:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .ptitle { font-family: var(--mono); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-2); font-weight: 700; }
  .body { padding: 16px; display: flex; flex-direction: column; overflow-y: auto; }
  .row { display: flex; align-items: center; gap: 9px; margin: 14px 0; }
  .sel { flex: 1; padding: 11px 13px; border: 1px solid var(--keyline-2); border-radius: 9px; background: #fff;
    color: var(--ink-2); font-family: var(--sans); font-weight: 600; font-size: 13px; }
  .ico { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--keyline);
    border-radius: 8px; background: var(--paper-2); color: var(--ink-3); font-size: 16px; cursor: pointer; transition: .14s; }
  .ico:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .castle { display: flex; gap: 20px; margin-bottom: 14px; }
  .castle .col { flex: 1; }
  .castle .lab { font-family: var(--mono); font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px; }
  .ck { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); margin-bottom: 7px; cursor: pointer; }
  .fen { width: 100%; padding: 12px 14px; border: 1px solid var(--keyline-2); border-radius: 9px; background: #fff;
    color: var(--ink-2); font-family: var(--mono); font-size: 11.5px; margin-bottom: 12px; }
  .fen:focus { outline: none; border-color: var(--green); box-shadow: 0 0 0 3px rgba(47,93,58,.12); }
  .pgn { width: 100%; height: 110px; padding: 13px 14px; border: 1px solid var(--keyline-2); border-radius: 9px;
    background: #fff; color: var(--ink-3); font-family: var(--mono); font-size: 11.5px; resize: vertical; margin-bottom: 12px; }
  .err { color: var(--blun); font-size: 12px; margin-bottom: 10px; }
  .primary { width: 100%; padding: 16px; border: none; border-radius: 10px; background: var(--green); color: #fff;
    font-family: var(--sans); font-weight: 700; font-size: 15px; cursor: pointer; transition: .14s; }
  .primary:hover { background: var(--green-soft); }
</style>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/tests/EditPanel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditPanel.svelte src/tests/EditPanel.test.ts
git commit -m "feat(ui): EditPanel board editor (palette, side, castling, FEN, PGN, Load)"
```

---

## Task 6: App integration — screen state, Home & Edit wiring, remove Source/Position

**Files:**
- Modify: `frontend/src/App.svelte`
- Create: `frontend/src/tests/App.test.ts`
- Modify: `frontend/src/tests/smoke.test.ts`
- Delete: `frontend/src/components/SourceControls.svelte`, `frontend/src/tests/SourceControls.test.ts`,
  `frontend/src/components/PositionControls.svelte`, `frontend/src/tests/PositionControls.test.ts`

This task makes the three-screen app work for Home ↔ Analysis ↔ Edit (capture flow is Task 7). It writes new App routing tests first, then refactors `App.svelte`.

- [ ] **Step 1: Write the failing App routing test** — create `src/tests/App.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

// Replace only `send` so transitions don't drive the real engine; keep the real stores.
vi.mock('../lib/engineClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/engineClient')>();
  return { ...real, send: vi.fn() };
});

import App from '../App.svelte';
import { send } from '../lib/engineClient';
const sendMock = send as unknown as ReturnType<typeof vi.fn>;

describe('App screen routing', () => {
  beforeEach(() => sendMock.mockClear());

  it('starts on the Home panel', () => {
    render(App);
    expect(screen.getByTestId('home-panel')).toBeTruthy();
    expect(screen.queryByTestId('analysis-card')).toBeNull();
    expect(screen.queryByTestId('edit-panel')).toBeNull();
  });

  it('Explore enters Analysis and enables the engine', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Explore'));
    expect(screen.getByTestId('analysis-card')).toBeTruthy();
    expect(screen.queryByTestId('home-panel')).toBeNull();
    expect(sendMock).toHaveBeenCalledWith({ type: 'set_analysis_enabled', enabled: true });
  });

  it('Start Analysis loads a pasted FEN then enters Analysis', async () => {
    render(App);
    await fireEvent.input(screen.getByPlaceholderText(/Paste your FEN/),
      { target: { value: '8/8/8/8/8/8/8/8 w - - 0 1' } });
    await fireEvent.click(screen.getByText('Start Analysis'));
    expect(sendMock).toHaveBeenCalledWith({ type: 'set_fen', fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
    expect(sendMock).toHaveBeenCalledWith({ type: 'set_analysis_enabled', enabled: true });
    expect(screen.getByTestId('analysis-card')).toBeTruthy();
  });

  it('Set Up Position enters the editor; Back returns Home', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Set Up Position'));
    expect(screen.getByTestId('edit-panel')).toBeTruthy();
    await fireEvent.click(screen.getByTestId('edit-back'));
    expect(screen.getByTestId('home-panel')).toBeTruthy();
  });

  it('New from Analysis returns Home, resets, and disables the engine', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Explore'));
    await fireEvent.click(screen.getByText('New'));
    expect(screen.getByTestId('home-panel')).toBeTruthy();
    expect(sendMock).toHaveBeenCalledWith({ type: 'set_analysis_enabled', enabled: false });
    expect(sendMock).toHaveBeenCalledWith({ type: 'reset' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/tests/App.test.ts`
Expected: FAIL — no `home-panel` testid (App still renders the old single card).

- [ ] **Step 3: Refactor `App.svelte`.** Make these exact changes.

  a. **Imports** — replace the `SourceControls`/`PositionControls` import lines with the new panels, and import `castleFromFen` + `CastlingRights`:
```ts
  import HomePanel from './components/HomePanel.svelte';
  import EditPanel from './components/EditPanel.svelte';
  import { buildFen, kingCountOk, castleFromFen } from './lib/edit';
  import type { CastlingRights } from './lib/edit';
```
  (Remove `import SourceControls ...` and `import PositionControls ...`. Keep the existing `buildFen, kingCountOk` import by merging into the line above — do not import them twice.)

  b. **State** — add near the other `let` declarations (after `let selectedEditPiece`):
```ts
  type Screen = 'home' | 'analysis' | 'edit';
  let screen: Screen = 'home';
  // Editor form state (initialized when entering the editor)
  let editSide: 'white' | 'black' = 'white';
  let editCastle: CastlingRights = { K: true, Q: true, k: true, q: true };
  let editFen = '';
```
  Replace the old `let editing = false;` with a reactive binding to the screen:
```ts
  $: editing = screen === 'edit';
```
  (Delete the standalone `let editing = false;` declaration. Everything that read `editing` now reads the derived value.)

  c. **Navigation helpers** — add these functions:
```ts
  function enterAnalysis(): void {
    screen = 'analysis';
    send({ type: 'set_analysis_enabled', enabled: true });
  }
  function onExplore(): void { enterAnalysis(); }
  function onStart(text: string): void {
    const fen = text.trim();
    if (fen) send({ type: 'set_fen', fen });   // PGN parsing deferred; treated as FEN for now
    enterAnalysis();
  }
  function onNew(): void {
    screen = 'home';
    manualFlip = false;
    send({ type: 'set_analysis_enabled', enabled: false });
    send({ type: 'reset' });
  }
  function onSetUp(): void {
    editError = null;
    const f = s?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    editSide = (s?.sideToMove ?? 'white') as 'white' | 'black';
    editCastle = castleFromFen(f);
    editFen = f;
    selectedEditPiece = 'P';
    screen = 'edit';
  }
  function onEditBack(): void { screen = 'home'; editError = null; }
```

  d. **Editor form handlers** — add:
```ts
  function rebuildEditFen(): void {
    editFen = buildFen(boardComp.getPlacement(), editSide, editCastle);
  }
  function onEditSide(white: boolean): void { editSide = white ? 'white' : 'black'; rebuildEditFen(); }
  function onToggleCastle(key: keyof CastlingRights): void {
    editCastle = { ...editCastle, [key]: !editCastle[key] };
    rebuildEditFen();
  }
  function onBoardEdit(_placement: string): void { rebuildEditFen(); }
  function onEditFenInput(text: string): void { editFen = text; }
  function onEditReset(): void {
    boardComp.setPlacement('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    rebuildEditFen();
  }
  function onEditClear(): void { boardComp.setPlacement('8/8/8/8/8/8/8/8'); rebuildEditFen(); }
  function onEditLoad(): void {
    const placement = boardComp.getPlacement();
    if (!kingCountOk(placement)) { editError = 'Need exactly one white and one black king.'; return; }
    editError = null;
    send({ type: 'set_fen', fen: editFen });
    enterAnalysis();
  }
```
  (Note: `onEditLoad` sends the FEN text field `editFen`, which is kept in sync with placement/side/castle via `onBoardEdit`/`rebuildEditFen` and may be manually overridden by the user typing in the field.)

  e. **`onMove`** — make a home move enter analysis first:
```ts
  function onMove(uci: string) {
    if (screen === 'home') enterAnalysis();
    send({ type: 'make_move', uci });
  }
```

  f. **Delete `onToggleEdit`** and the commit-dance reactive block. Specifically remove the `committing` / `committedPlacement` / `lastSeq` machinery tied to the old edit toggle:
  - delete `let committing = false;`, `let lastSeq = 0;`, `let committedPlacement: string | null = null;`
  - delete the `function onToggleEdit() { … }`
  - delete the two reactive blocks `$: if (committing && $errorSeq !== lastSeq) { … }` and `$: if (committing && s && …) { … }`
  (The new editor commits via `onEditLoad`; a rejected `set_fen` surfaces through the existing `lastError`/`errorSeq` path — see Step 3h.)

  g. **Board props** — pass `onEdit={onBoardEdit}` to `<Board>`:
```svelte
  <Board bind:this={boardComp} {fen} {orientation} {onMove} revertSignal={$errorSeq}
    lines={s?.lines ?? []} showArrows={viewPrefs.arrows && analysisEnabled}
    {editing} {selectedEditPiece} onEdit={onBoardEdit} />
```
  Remove the old in-board-column `{#if editing}<EditPalette .../>{/if}` and the `{#if editError}...{/if}` line (the palette and the error now live inside `EditPanel`). Remove the now-unused `EditPalette` import from App.

  h. **Right column** — replace the entire `<div class="panel"> … </div>` block with screen-routed panels:
```svelte
    <div class="panel">
      {#if screen === 'home'}
        <HomePanel hasCapture={hasCapture} onSetUp={onSetUp} onExplore={onExplore}
          onCapture={onPickRegion} onStart={onStart} />
      {:else if screen === 'edit'}
        <EditPanel fen={editFen} side={editSide} castle={editCastle} selected={selectedEditPiece}
          editError={editError}
          onSelect={onSelectPiece} onSide={onEditSide} onToggleCastle={onToggleCastle}
          onFlip={onFlip} onReset={onEditReset} onClear={onEditClear}
          onFenInput={onEditFenInput} onLoad={onEditLoad} onBack={onEditBack} />
      {:else}
        <section class="card" data-testid="analysis-card">
          <div class="sec">
            <EngineHeader
              {analysisEnabled}
              analyzing={s?.analyzing ?? false}
              depth={s?.depth ?? 0}
              engineId={s?.engineId ?? 'stockfish'}
              onCommand={send}
              onSetEngine={(id) => send({ type: 'set_engine', id })}
              prefs={viewPrefs}
              onToggle={onToggleView} />
            {#if viewPrefs.lines && analysisEnabled && (s?.lines?.length ?? 0) > 0}
              <div class="bd">
                {#key s?.fen}
                  <Lines lines={s?.lines ?? []} />
                {/key}
              </div>
            {/if}
          </div>

          {#if viewPrefs.feedback && analysisEnabled && s?.lastMove}
            <div class="sec" data-testid="feedback-section">
              <div class="bd">
                <MoveFeedback lastMove={s?.lastMove ?? null}
                  onPlayBest={(uci) => send({ type: 'play_best', uci })}
                  gameOver={s?.gameOver ?? null} />
              </div>
            </div>
          {/if}

          <div class="sec grow">
            <MoveHistory moveList={s?.moveList ?? []} currentPly={s?.currentPly ?? 0}
              {onNavigate} />
          </div>

          <div class="sec">
            <ActionBar currentPly={s?.currentPly ?? 0} total={s?.moveList?.length ?? 0}
              {onNavigate} onNew={onNew} />
          </div>
        </section>
      {/if}
    </div>
```
  (The Source section `{#if hasCapture}<SourceControls .../>` and the Position section `<PositionControls .../>` are removed entirely. `hasCapture` is still used — by `HomePanel` above — so keep `const hasCapture = hasNativeCapture();`.)

  i. **Keep** `onFlip`, `onNavigate`, `onSelectPiece`, the region helpers (`onPickRegion`, `onConfirmRegion`, `onCancelRegion`, `pickingRegion`), the `RegionOverlay` block at the bottom, and `editError` (`let editError: string | null = null;`). The `RegionOverlay` block stays as-is for Task 7.

- [ ] **Step 4: Update `smoke.test.ts`** so it accounts for Home-first. Replace its contents with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('../lib/engineClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/engineClient')>();
  return { ...real, send: vi.fn() };
});

import App from '../App.svelte';
import { state } from '../lib/engineClient';

function stateFrame(overrides: Record<string, unknown> = {}) {
  return {
    type: 'state',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    sideToMove: 'white', engineId: 'stockfish', analyzing: false,
    eval: { cp: 20, mate: null, text: '+0.20' }, depth: 12,
    lines: [{ multipv: 1, scoreText: '+0.20', cp: 20, mate: null, pv: [], san: '1.e4' }],
    lastMove: {
      classification: { label: 'good', cpl: 10, isBest: false },
      played: { san: 'e4', uci: 'e2e4', evalText: '+0.20', pv: '' },
      best: { san: 'd4', uci: 'd2d4', evalText: '+0.25', pv: '' },
    },
    visionStatus: 'idle', detectedOrientation: null, lowConfidence: [], region: null,
    moveList: [{ ply: 1, san: 'e4', uci: 'e2e4', classification: { label: 'good', cpl: 10, isBest: false } }],
    currentPly: 1, analysisEnabled: true, movetime: 10000,
    ...overrides,
  };
}

/** Render App and click Explore to reach the Analysis screen. */
async function renderAnalysis() {
  render(App);
  await fireEvent.click(screen.getByText('Explore'));
}

describe('App shell', () => {
  it('mounts without throwing and renders the board', () => {
    render(App);
    expect(screen.getByTestId('board')).toBeTruthy();
  });

  it('shows the Home panel at startup', () => {
    render(App);
    expect(screen.getByTestId('home-panel')).toBeTruthy();
  });

  it('renders the analysis card with EngineHeader after Explore', async () => {
    await renderAnalysis();
    expect(screen.getByText('Analysis')).toBeTruthy();
  });

  it('renders the ChessMenthol brand from Header', () => {
    render(App);
    expect(screen.getByRole('heading', { name: /chessMenthol/i })).toBeTruthy();
  });
});

describe('analysis-disabled gating', () => {
  beforeEach(() => { localStorage.clear(); });

  it('shows eval bar, engine lines, and move feedback when analysis is enabled and populated', async () => {
    await renderAnalysis();
    state.set(stateFrame({ analysisEnabled: true }) as never);
    await tick();
    expect(screen.getByTestId('evalbar')).toBeTruthy();
    expect(screen.getByTestId('lines')).toBeTruthy();
    expect(screen.getByTestId('feedback-section')).toBeTruthy();
    expect(screen.getByTestId('movefeedback')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View options' })).toBeTruthy();
  });

  it('hides the empty engine-lines and move-feedback sections (no empty dividers)', async () => {
    await renderAnalysis();
    state.set(stateFrame({ analysisEnabled: true, lines: [], lastMove: null }) as never);
    await tick();
    expect(screen.queryByTestId('lines')).toBeNull();
    expect(screen.queryByTestId('feedback-section')).toBeNull();
    expect(screen.getByTestId('evalbar')).toBeTruthy();
  });

  it('hides eval bar, engine lines, move feedback, and View options when analysis is disabled', async () => {
    await renderAnalysis();
    state.set(stateFrame({ analysisEnabled: false }) as never);
    await tick();
    expect(screen.queryByTestId('evalbar')).toBeNull();
    expect(screen.queryByTestId('lines')).toBeNull();
    expect(screen.queryByTestId('movefeedback')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View options' })).toBeNull();
    expect(screen.getByText('Analysis')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Engine settings' })).toBeTruthy();
  });
});

describe('toolchain', () => {
  it('runs vitest', () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 5: Delete the retired components and their tests**

```bash
git rm src/components/SourceControls.svelte src/tests/SourceControls.test.ts \
       src/components/PositionControls.svelte src/tests/PositionControls.test.ts
```

- [ ] **Step 6: Run the affected tests + type/svelte checks**

Run: `npx vitest run src/tests/App.test.ts src/tests/smoke.test.ts`
Expected: PASS.

Run: `npm run check`   (runs `svelte-check`/`tsc`; confirm 0 errors — this catches dangling references to the deleted components or `onToggleEdit`.)
Expected: 0 errors, 0 warnings.

- [ ] **Step 7: Run the full suite to catch fallout**

Run: `npx vitest run`
Expected: PASS (no remaining import of `SourceControls`/`PositionControls`; no test references them).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(app): three-screen Home/Analysis/Edit routing; drop Source/Position panels"
```

---

## Task 7: App — Capture Board flow (desktop)

**Files:**
- Modify: `frontend/src/lib/region.ts`
- Modify: `frontend/src/tests/region.test.ts`
- Modify: `frontend/src/App.svelte`

Goal: the Home `Capture Board` button (wired to `onPickRegion` in Task 6) opens the region overlay; confirming the region sets the region, captures, and enters Analysis. To keep this TDD-able (the overlay needs a real screenshot to render in jsdom), the two capture commands are produced by a **pure helper** `captureCommands(region)` that we unit-test directly; `App.onConfirmRegion` calls it then `enterAnalysis()`.

- [ ] **Step 1: Write the failing test** — append to `src/tests/region.test.ts`:

```ts
import { captureCommands } from '../lib/region';

describe('captureCommands', () => {
  it('sets the region then captures, in order', () => {
    expect(captureCommands({ left: 1, top: 2, width: 3, height: 4 })).toEqual([
      { type: 'set_region', left: 1, top: 2, width: 3, height: 4 },
      { type: 'capture_now' },
    ]);
  });
});
```

(If `region.test.ts` does not already import `describe/it/expect`, add `import { describe, it, expect } from 'vitest';` at the top.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/tests/region.test.ts`
Expected: FAIL — `captureCommands` is not exported.

- [ ] **Step 3: Implement the helper** — append to `src/lib/region.ts`:

```ts
import type { Command } from './types';

/** The command sequence for a confirmed capture region: set it, then capture. */
export function captureCommands(r: Region): Command[] {
  return [
    { type: 'set_region', left: r.left, top: r.top, width: r.width, height: r.height },
    { type: 'capture_now' },
  ];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/tests/region.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into App** — in `src/App.svelte`, import the helper and update `onConfirmRegion`:

  a. Add `captureCommands` to the existing region import:
```ts
  import { captureCommands } from './lib/region';
  import type { Region } from './lib/region';
```
  (Merge with the existing `import type { Region } from './lib/region';` — keep a single `import type` line and add the value import, or combine as `import { captureCommands, type Region } from './lib/region';`.)

  b. Replace `onConfirmRegion`:
```ts
  function onConfirmRegion(r: Region) {
    pickingRegion = false;
    for (const c of captureCommands(r)) send(c);
    enterAnalysis();
  }
```
  (`onPickRegion` and `onCancelRegion` are unchanged. `onPickRegion` is already passed to `HomePanel` as `onCapture` in Task 6, and `onConfirmRegion`/`onCancelRegion` are already bound to the `<RegionOverlay>` block at the bottom of `App.svelte`.)

- [ ] **Step 6: Verify**

Run: `npm run check`
Expected: 0 errors (confirms the new `enterAnalysis()`/import wiring type-checks).

Run: `npx vitest run src/tests/region.test.ts src/tests/App.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): single-button Capture Board flow (region -> capture -> analysis)"
```

---

## Task 8: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Type/svelte check**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Full unit suite**

Run: `npx vitest run`
Expected: all green. Confirm counts increased by the new HomePanel/EditPanel/App tests and that no test imports the deleted components.

- [ ] **Step 3: Rust gate (unchanged, sanity)**

Run: `cd ../ && cargo test --manifest-path src-tauri/Cargo.toml` (adjust path if the Tauri crate lives elsewhere; skip if no Rust changed — this feature touches none).
Expected: PASS / unchanged.

- [ ] **Step 4: Manual desktop e2e (human gate)**

Run: `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev` (from `frontend`).
Verify, with the test engines at `/home/buga/uci-engines/` if needed:
  1. App opens on the **Home** panel (board left, Start panel right).
  2. **Move a piece** on the home board → jumps to **Analysis**, engine on.
  3. **New** (bottom) → returns Home, board reset, engine off.
  4. **Explore** → Analysis, engine on.
  5. **Start Analysis** with a pasted FEN → loads it, Analysis, engine on.
  6. **Set Up Position** → Edit screen; palette places pieces; side dropdown, castling
     checkboxes, flip/reset/clear, and the FEN field all update; **Load** → Analysis with
     the constructed position. **←** returns Home (edits discarded).
  7. **Capture Board** → region overlay → drag a region → Apply → Analysis shows the
     captured position (engine on).

- [ ] **Step 5: Commit (if any manual-fix tweaks were needed)**

```bash
git add -A && git commit -m "fix(app): manual e2e adjustments for screen redesign"   # only if needed
```

---

## Self-review notes (author)

- **Spec coverage:** Home panel (Task 4/6), Edit parity incl. castling+PGN box (Task 1/5/6), Source/Position removal (Task 6), single-button capture (Task 7), move-on-home explore (Task 6), back-on-top for Edit + New-at-bottom for Analysis (Task 2/5/6), engine-on transitions (Task 6/7). All covered.
- **Deferred (per spec):** real PGN parsing/import (the PGN box is read-only placeholder); populating the PGN box from the current game; renaming "New" → "Home"/"Back" (trivial label change in `ActionBar`).
- **Type consistency:** `CastlingRights` defined in `lib/edit.ts` (Task 1) and consumed by `EditPanel` (Task 5) and `App` (Task 6); `buildFen(placement, side, rights?)`, `castleFromFen(fen)`, `Board.setPlacement(placement)`, `Board.onEdit(placement)`, `ActionBar.onNew`, `HomePanel.{onSetUp,onExplore,onCapture,onStart}`, `EditPanel.{onSelect,onSide,onToggleCastle,onFlip,onReset,onClear,onFenInput,onLoad,onBack}` — names are consistent across tasks.
- **Known simplification:** manual edits to the editor's FEN field are overwritten when a visual control (palette/board/side/castle) subsequently changes; documented in the spec.
```
