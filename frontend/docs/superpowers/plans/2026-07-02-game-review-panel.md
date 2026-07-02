# Game Review — summary panel + Review screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the post–computer-analysis experience into a chess.com-style **Game Report summary** (per-player accuracy + counts for all 10 move classes, a header whose right icon returns to Analysis, and a **Start Review** button) plus a dedicated **Review** screen (eval graph + move list with badges + per-move feedback + a nav stepper with play/pause auto-play, and a Back button to the summary).

**Architecture:** Four tasks over the existing report code. (1) Widen the report data model to all 10 per-side class counts + player names, computed via a new pure `perSideClassCounts` helper. (2) Extract the nav stepper from `ActionBar` into a reusable `MoveStepper` with an optional play/pause button. (3) New `GameReportSummary` replaces `ReportPanel` on the `report` screen, with the new header nav. (4) New `review` screen composing the (re-homed) `EvalGraph`, `MoveHistory` (with badges), `MoveFeedback`, and `MoveStepper` + client-side auto-play.

**Tech Stack:** TypeScript, Svelte, Vitest, @testing-library/svelte, chessops.

**Spec:** `docs/superpowers/specs/2026-07-02-game-review-panel-design.md`

**Conventions:**
- All commands run from `frontend/`.
- Single-file test: `npx vitest run src/tests/<file>.test.ts`. Typecheck+svelte-check: `npm run check`. Full: `npx vitest run`.
- TDD: write the test, watch it fail, implement, watch it pass, commit. Follow existing component/orchestrator patterns.

**Reuse (already exists — do NOT rebuild):**
- `src/core/classify.ts` `MoveClass` = the 10 classes; `classifyMove` already labels every ply.
- `src/lib/glyphs.ts` `glyphFor(label)` → `{kind,symbol,color}` for **all 10** classes; `src/components/MoveBadge.svelte` renders a badge from `label`+`size`.
- `src/components/MoveHistory.svelte` — two-column White/Black move list, click-to-jump (`onNavigate(ply)`), current-ply highlight, auto-scroll, class-colored SAN via `src/lib/moveclass.ts` `moveColor`.
- `src/components/EvalGraph.svelte` (props `wins, currentPly, onNavigate`) and `src/components/MoveFeedback.svelte` (props `lastMove, evaluating, onPlayBest, gameOver`).
- `serialize.ts` has NO report serializer — `GameReportDto` is sent as-is, so new DTO fields need no serialize change.

---

## File Structure

**Modify:**
- `src/lib/types.ts` — `PlayerReportDto` gains 7 counts; `GameReportDto` gains `whiteName?/blackName?`.
- `src/core/orchestrator.ts` — `_buildReport` uses `perSideClassCounts`; store PGN names in `loadPgn`; clear in `reset`/`_applyFen`; new fields `_whiteName?/_blackName?`.
- `src/components/ActionBar.svelte` — use extracted `MoveStepper` for its nav row.
- `src/components/MoveHistory.svelte` — optional `showBadges` prop.
- `src/App.svelte` — `Screen` gains `'review'`; new handlers; render `GameReportSummary` on `report` + the Review card on `review`; move `EvalGraph` into Review; auto-play; remove `ReportPanel` usage.
- `src/tests/App.test.ts` — the report-flow tests that click `report-back` switch to `report-to-analysis`; add `annotating`/new count fields where literals break.

**Create:**
- `src/core/report.ts` — `perSideClassCounts` + `ClassCounts`.
- `src/components/MoveStepper.svelte`
- `src/components/GameReportSummary.svelte`
- Tests: `src/tests/report.test.ts`, `src/tests/MoveStepper.test.ts`, `src/tests/GameReportSummary.test.ts`.

**Remove (Task 3):** `src/components/ReportPanel.svelte` + `src/components/AccuracyDial.svelte` (orphaned once the summary replaces them) and their tests if present.

---

## Task 1: Report data model — all 10 per-side counts + player names

**Files:**
- Create: `src/core/report.ts`; Test: `src/tests/report.test.ts`
- Modify: `src/lib/types.ts`, `src/core/orchestrator.ts`, and any test literal the new required fields break.

- [ ] **Step 1: Write the failing test** — create `src/tests/report.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { perSideClassCounts, emptyClassCounts } from '../core/report';
import type { PlyReportDto } from '../lib/types';

function ply(n: number, label: string | null): PlyReportDto {
  return { ply: n, san: 'x', uci: 'a2a3', winWhite: 50, cpl: 0,
    classification: label ? { label, cpl: 0, isBest: false } : null };
}

describe('perSideClassCounts', () => {
  it('starts every class at 0 for both sides', () => {
    const { white, black } = perSideClassCounts([]);
    for (const c of ['brilliant','great','best','excellent','good','book','inaccuracy','mistake','blunder','miss'] as const) {
      expect(white[c]).toBe(0); expect(black[c]).toBe(0);
    }
  });

  it('attributes odd plies to White and even plies to Black, by class', () => {
    const plies = [
      ply(1, 'brilliant'), // white
      ply(2, 'blunder'),   // black
      ply(3, 'best'),      // white
      ply(4, 'miss'),      // black
      ply(5, 'best'),      // white
      ply(6, null),        // black, unclassified -> ignored
    ];
    const { white, black } = perSideClassCounts(plies);
    expect(white.brilliant).toBe(1);
    expect(white.best).toBe(2);
    expect(black.blunder).toBe(1);
    expect(black.miss).toBe(1);
    expect(black.brilliant).toBe(0);
  });

  it('attributes by mover color, not ply parity, when Black starts', () => {
    // startWhite=false: ply 1 is Black's move, ply 2 is White's.
    const { white, black } = perSideClassCounts([ply(1, 'blunder'), ply(2, 'best')], false);
    expect(black.blunder).toBe(1);
    expect(white.best).toBe(1);
    expect(white.blunder).toBe(0);
  });

  it('emptyClassCounts has all 10 keys at 0', () => {
    expect(Object.values(emptyClassCounts()).every((v) => v === 0)).toBe(true);
    expect(Object.keys(emptyClassCounts())).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing): `npx vitest run src/tests/report.test.ts`

- [ ] **Step 3: Create `src/core/report.ts`:**

```ts
import type { PlyReportDto } from '../lib/types';

/** Count of each of the 10 move classes for one side. Keys are MoveClass string values. */
export interface ClassCounts {
  brilliant: number; great: number; best: number; excellent: number; good: number;
  book: number; inaccuracy: number; mistake: number; blunder: number; miss: number;
}

export function emptyClassCounts(): ClassCounts {
  return { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0,
           book: 0, inaccuracy: 0, mistake: 0, blunder: 0, miss: 0 };
}

/** Tally classified plies into per-side class counts, attributing each ply to the
 *  side that actually moved. `startWhite` = White moves on ply 1 (false for a game
 *  starting from a Black-to-move position). Unclassified/unknown labels are ignored. */
export function perSideClassCounts(
  plies: PlyReportDto[],
  startWhite = true,
): { white: ClassCounts; black: ClassCounts } {
  const white = emptyClassCounts();
  const black = emptyClassCounts();
  for (const p of plies) {
    const label = p.classification?.label;
    if (!label) continue;
    const moverWhite = startWhite ? p.ply % 2 === 1 : p.ply % 2 === 0;
    const side = moverWhite ? white : black;
    if (label in side) (side as Record<string, number>)[label]++;
  }
  return { white, black };
}
```

- [ ] **Step 4: Widen the DTOs in `src/lib/types.ts`** — replace the `PlayerReportDto` line and add names to `GameReportDto`:

```ts
export interface PlayerReportDto {
  accuracy: number; acpl: number;
  brilliant: number; great: number; best: number; excellent: number; good: number;
  book: number; inaccuracy: number; mistake: number; blunder: number; miss: number;
}
export interface GameReportDto {
  white: PlayerReportDto; black: PlayerReportDto;
  whiteName?: string; blackName?: string;
  startWin: number;
  plies: PlyReportDto[];
}
```

- [ ] **Step 5: Use the helper + names in `src/core/orchestrator.ts` `_buildReport`.** Replace the inline `counts`/increment logic and the `return` object:

Inside the loop, delete these now-dead lines (they reference the old `counts`): the `const counts = { white: { i:0,... }, black: { ... } }` declaration, the `const moverWhite = board.turn === 'white';` line, the `const side = moverWhite ? counts.white : counts.black;` line, and the three `if (c.label === MoveClass.INACCURACY) side.i++ / else if … side.m++ / else … side.b++` lines. Keep everything else in the loop (`entry.classification = c`, `entry.lastMove = …`, `entry.preAnalysis = before`, the `plies.push({...})`, and `board = playUci(...)`). After the loop, before `return`, add:

```ts
    const cc = perSideClassCounts(plies, startWhite);
    const player = (accuracyVal: number, side: 'white' | 'black', c: import('./report').ClassCounts): PlayerReportDto => ({
      accuracy: Math.round(accuracyVal),
      acpl: acpl(cpsPositions, startWhite, side),
      brilliant: c.brilliant, great: c.great, best: c.best, excellent: c.excellent, good: c.good,
      book: c.book, inaccuracy: c.inaccuracy, mistake: c.mistake, blunder: c.blunder, miss: c.miss,
    });
```

Replace the `return { white: {...}, black: {...}, startWin, plies };` with:

```ts
    return {
      white: player(white, 'white', cc.white),
      black: player(black, 'black', cc.black),
      whiteName: this._whiteName,
      blackName: this._blackName,
      startWin: winPercent(cpsPositions[0]),
      plies,
    };
```

Add the import at the top (near the other `./` imports): `import { perSideClassCounts } from './report';`. (`PlayerReportDto` is already imported for the return type; if not, add it to the `../lib/types` import.) The `MoveClass` import may now be unused in `_buildReport` — leave it if used elsewhere in the file; if `npm run check` flags it as unused, remove it from the import.

- [ ] **Step 6: Store player names from PGN headers.** Add fields near the other orchestrator state (e.g. beside `_baseFen`):

```ts
  private _whiteName: string | undefined = undefined;
  private _blackName: string | undefined = undefined;
```

In `loadPgn`, after `parsed = parseGame(pgn);` succeeds (the parse result exposes `.headers`, a `Map<string,string>` — see `core/pgn.ts`), set the names right after `this._history = [];`:

```ts
    this._whiteName = parsed.headers.get('White') || undefined;
    this._blackName = parsed.headers.get('Black') || undefined;
```

Clear them for non-PGN games: in `reset()` and in `_applyFen(...)` (the FEN/setup path used by captured/edited games), add `this._whiteName = undefined; this._blackName = undefined;`. (Read those methods to place the lines with the other state resets.)

- [ ] **Step 7: Fix broken literals.** Run `npm run check`. The new required `PlayerReportDto` fields break every hand-built `GameReportDto` literal (e.g. `baseReport` in `src/tests/App.test.ts`). For each flagged literal, add the 7 new counts to its `white`/`black` objects: `brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, miss: 0`. Repeat until `check` is clean.

- [ ] **Step 8: Run tests + check** — `npx vitest run src/tests/report.test.ts && npm run check` → PASS, 0/0. Then `npx vitest run` → all green.

- [ ] **Step 9: Commit**

```bash
git add src/core/report.ts src/tests/report.test.ts src/lib/types.ts src/core/orchestrator.ts src/tests/App.test.ts
git commit -m "feat(report): tally all 10 move-class counts per side + PGN player names"
```

---

## Task 2: Extract `MoveStepper` (with optional play/pause) from `ActionBar`

**Files:**
- Create: `src/components/MoveStepper.svelte`; Test: `src/tests/MoveStepper.test.ts`
- Modify: `src/components/ActionBar.svelte`

- [ ] **Step 1: Write the failing test** — create `src/tests/MoveStepper.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MoveStepper from '../components/MoveStepper.svelte';

describe('MoveStepper', () => {
  it('navigates first/prev/next/last', async () => {
    const onNavigate = vi.fn();
    const { getAllByRole } = render(MoveStepper, { props: { currentPly: 3, total: 8, onNavigate } });
    const btns = getAllByRole('button');
    await fireEvent.click(btns[0]); expect(onNavigate).toHaveBeenCalledWith(0);       // first
    await fireEvent.click(btns[1]); expect(onNavigate).toHaveBeenCalledWith(2);       // prev
    await fireEvent.click(btns[2]); expect(onNavigate).toHaveBeenCalledWith(4);       // next
    await fireEvent.click(btns[3]); expect(onNavigate).toHaveBeenCalledWith(8);       // last
  });

  it('shows no play button without onTogglePlay', () => {
    const { queryByTestId } = render(MoveStepper, { props: { currentPly: 0, total: 4, onNavigate: () => {} } });
    expect(queryByTestId('autoplay')).toBeNull();
  });

  it('shows play/pause when onTogglePlay is set and toggles the icon by `playing`', async () => {
    const onTogglePlay = vi.fn();
    const { getByTestId, rerender } = render(MoveStepper, {
      props: { currentPly: 0, total: 4, onNavigate: () => {}, onTogglePlay, playing: false },
    });
    const b = getByTestId('autoplay');
    expect(b.getAttribute('title')).toBe('Auto-play');
    await fireEvent.click(b);
    expect(onTogglePlay).toHaveBeenCalled();
    await rerender({ currentPly: 0, total: 4, onNavigate: () => {}, onTogglePlay, playing: true });
    expect(getByTestId('autoplay').getAttribute('title')).toBe('Pause');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (component missing): `npx vitest run src/tests/MoveStepper.test.ts`

- [ ] **Step 3: Create `src/components/MoveStepper.svelte`** (the nav row lifted from `ActionBar`, plus an optional centered play/pause):

```svelte
<script lang="ts">
  import Icon from './Icon.svelte';
  export let currentPly: number = 0;
  export let total: number = 0;
  export let onNavigate: (ply: number) => void = () => {};
  // When onTogglePlay is provided, a play/pause button appears between prev and next.
  export let playing: boolean = false;
  export let onTogglePlay: (() => void) | null = null;
</script>

<div class="nav">
  <button type="button" class="navbtn" title="First move"
    on:click={() => onNavigate(0)}><Icon name="JumpFirst" /></button>
  <button type="button" class="navbtn" title="Previous move"
    on:click={() => onNavigate(currentPly - 1)}><Icon name="JumpPrev" /></button>
  {#if onTogglePlay}
    <button type="button" class="navbtn play" data-testid="autoplay"
      title={playing ? 'Pause' : 'Auto-play'} on:click={onTogglePlay}>
      <Icon name={playing ? 'Pause' : 'PlayTriangle'} />
    </button>
  {/if}
  <button type="button" class="navbtn" title="Next move"
    on:click={() => onNavigate(currentPly + 1)}><Icon name="JumpNext" /></button>
  <button type="button" class="navbtn" title="Last move"
    on:click={() => onNavigate(total)}><Icon name="JumpLast" /></button>
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
  .navbtn.play { color: var(--green); }
</style>
```

- [ ] **Step 4: Use it in `src/components/ActionBar.svelte`.** Add `import MoveStepper from './MoveStepper.svelte';` under the `Icon` import. Replace the entire `<div class="nav"> … </div>` block (the 4 nav buttons) with:

```svelte
<MoveStepper {currentPly} {total} {onNavigate} />
```

Delete the now-unused `.nav` and `.navbtn` (+ `.navbtn:hover`) rules from `ActionBar`'s `<style>` (they live in `MoveStepper` now). Leave the rest (`.analyzing/.bar/.fill/.cancel/.acts/.act*`) unchanged — those are still used.

- [ ] **Step 5: Run tests** — `npx vitest run src/tests/MoveStepper.test.ts src/tests/ActionBar.test.ts && npm run check` → PASS, 0/0 (the existing ActionBar nav tests still pass through the extracted component). Then `npx vitest run` → all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/MoveStepper.svelte src/tests/MoveStepper.test.ts src/components/ActionBar.svelte
git commit -m "refactor(actionbar): extract MoveStepper with optional play/pause control"
```

---

## Task 3: `GameReportSummary` + report-screen wiring + header nav

**Files:**
- Create: `src/components/GameReportSummary.svelte`; Test: `src/tests/GameReportSummary.test.ts`
- Modify: `src/App.svelte`, `src/tests/App.test.ts`
- Remove: `src/components/ReportPanel.svelte`, `src/components/AccuracyDial.svelte` (+ their tests if present)

- [ ] **Step 1: Write the failing test** — create `src/tests/GameReportSummary.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import GameReportSummary from '../components/GameReportSummary.svelte';
import type { GameReportDto } from '../lib/types';

function pr(over: Partial<import('../lib/types').PlayerReportDto> = {}) {
  return { accuracy: 88, acpl: 20, brilliant: 0, great: 1, best: 18, excellent: 14, good: 2,
    book: 1, inaccuracy: 2, mistake: 1, blunder: 0, miss: 0, ...over };
}
const report: GameReportDto = {
  white: pr({ accuracy: 88 }), black: pr({ accuracy: 82, blunder: 1 }),
  whiteName: 'Ada', blackName: 'Bo', startWin: 50, plies: [],
};

describe('GameReportSummary', () => {
  it('shows both accuracies, player names, and per-side class counts', () => {
    const { getByTestId, getByText } = render(GameReportSummary, { props: { report } });
    expect(getByTestId('acc-white').textContent).toContain('88');
    expect(getByTestId('acc-black').textContent).toContain('82');
    expect(getByText('Ada')).toBeTruthy();
    expect(getByText('Bo')).toBeTruthy();
    // brilliant row: white 0 / black 0
    expect(getByTestId('cat-blunder').textContent).toContain('1'); // black blunder = 1
  });

  it('falls back to White/Black when names are absent', () => {
    const { getByText } = render(GameReportSummary, { props: { report: { ...report, whiteName: undefined, blackName: undefined } } });
    expect(getByText('White')).toBeTruthy();
    expect(getByText('Black')).toBeTruthy();
  });

  it('fires Start Review and Back-to-analysis handlers', async () => {
    const onStartReview = vi.fn(), onBackToAnalysis = vi.fn();
    const { getByTestId } = render(GameReportSummary, { props: { report, onStartReview, onBackToAnalysis } });
    await fireEvent.click(getByTestId('start-review')); expect(onStartReview).toHaveBeenCalled();
    await fireEvent.click(getByTestId('report-to-analysis')); expect(onBackToAnalysis).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (component missing): `npx vitest run src/tests/GameReportSummary.test.ts`

- [ ] **Step 3: Create `src/components/GameReportSummary.svelte`:**

```svelte
<script lang="ts">
  import Icon from './Icon.svelte';
  import MoveBadge from './MoveBadge.svelte';
  import type { GameReportDto } from '../lib/types';

  export let report: GameReportDto;
  export let onStartReview: () => void = () => {};
  export let onBackToAnalysis: () => void = () => {};
  export let onNew: () => void = () => {};

  // Count keys double as the MoveBadge label (same MoveClass strings). Display order
  // matches the reference screenshot.
  type CatKey = 'brilliant' | 'great' | 'book' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';
  const CATS: { key: CatKey; label: string }[] = [
    { key: 'brilliant', label: 'Brilliant' }, { key: 'great', label: 'Great' },
    { key: 'book', label: 'Book' }, { key: 'best', label: 'Best' },
    { key: 'excellent', label: 'Excellent' }, { key: 'good', label: 'Good' },
    { key: 'inaccuracy', label: 'Inaccuracy' }, { key: 'mistake', label: 'Mistake' },
    { key: 'miss', label: 'Miss' }, { key: 'blunder', label: 'Blunder' },
  ];
</script>

<div class="card" data-testid="report-panel">
  <header class="ghead">
    <span class="medal"><Icon name="Trophy" /></span>
    <span class="gtitle">Game Review</span>
    <button type="button" class="toanalysis" data-testid="report-to-analysis"
      title="Back to analysis" aria-label="Back to analysis" on:click={onBackToAnalysis}><Icon name="Microscope" /></button>
  </header>

  <div class="players">
    <div class="pl"><span class="avatar white"></span><span class="pname">{report.whiteName ?? 'White'}</span>
      <span class="acc" data-testid="acc-white">{report.white.accuracy}</span></div>
    <div class="mid"><span class="albl">Accuracy</span></div>
    <div class="pl"><span class="avatar black"></span><span class="pname">{report.blackName ?? 'Black'}</span>
      <span class="acc" data-testid="acc-black">{report.black.accuracy}</span></div>
  </div>

  <div class="cats">
    {#each CATS as c (c.key)}
      <div class="crow" data-testid="cat-{c.key}">
        <span class="cnt">{report.white[c.key]}</span>
        <span class="cmid"><MoveBadge label={c.key} size={18} /><span class="clabel">{c.label}</span></span>
        <span class="cnt">{report.black[c.key]}</span>
      </div>
    {/each}
  </div>

  <div class="gacts">
    <button type="button" class="new" on:click={onNew}>New</button>
    <button type="button" class="review" data-testid="start-review" on:click={onStartReview}>Start Review</button>
  </div>
</div>

<style>
  .card {
    background: var(--card); border: 1px solid var(--keyline); border-radius: 8px;
    box-shadow: 0 1px 0 #fff inset, 0 12px 30px -24px rgba(40,30,15,.45);
    display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto;
  }
  .ghead { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
    padding: 12px 15px; border-bottom: 1px solid var(--keyline); }
  .medal { color: var(--green); font-size: 18px; justify-self: start; }
  .gtitle { font-family: var(--sans); font-weight: 800; font-size: 15px; color: var(--ink); text-align: center; }
  .toanalysis { justify-self: end; width: 30px; height: 30px; display: grid; place-items: center;
    border: 1px solid var(--keyline-2); border-radius: 7px; background: var(--paper-2);
    color: var(--ink-2); font-size: 15px; cursor: pointer; }
  .toanalysis:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .players { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
    padding: 14px 16px; border-bottom: 1px solid var(--keyline); }
  .pl { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .avatar { width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--keyline-2); }
  .avatar.white { background: #f7f3ea; } .avatar.black { background: #2b2823; }
  .pname { font-family: var(--sans); font-weight: 600; font-size: 12.5px; color: var(--ink); }
  .acc { font-family: var(--mono); font-weight: 700; font-size: 16px; color: var(--ink);
    background: var(--paper-2); border: 1px solid var(--keyline-2); border-radius: 6px; padding: 2px 12px; }
  .albl { font-family: var(--mono); font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); }
  .cats { padding: 6px 10px; }
  .crow { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 6px 8px; }
  .crow:nth-child(odd) { background: rgba(40,30,15,.022); }
  .cnt { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink-2); text-align: center; }
  .cmid { display: flex; align-items: center; gap: 8px; justify-content: flex-start; padding-left: 18px; }
  .clabel { font-family: var(--sans); font-size: 13px; color: var(--ink); }
  .gacts { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-top: 1px solid var(--keyline); }
  .new { padding: 9px 16px; border: 1px solid var(--keyline-2); border-radius: 8px; background: var(--paper-2);
    font-family: var(--sans); font-weight: 600; font-size: 13px; color: var(--ink-2); cursor: pointer; }
  .new:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .review { padding: 12px 16px; border: none; border-radius: 9px; background: var(--green);
    font-family: var(--sans); font-weight: 800; font-size: 15px; color: #fff; cursor: pointer; }
  .review:hover { filter: brightness(1.05); }
</style>
```

- [ ] **Step 4: Wire it into `src/App.svelte`.** (a) Add `'review'` to the `Screen` union: `type Screen = 'home' | 'analysis' | 'edit' | 'report' | 'review';`. (b) Replace the import `import ReportPanel from './components/ReportPanel.svelte';` with `import GameReportSummary from './components/GameReportSummary.svelte';`. (c) Rename `onReportBack` to `onBackToAnalysis` (same body `screen = 'analysis';`) and add:

```ts
  function onStartReview(): void { onNavigate(0); screen = 'review'; }
  function onReviewBack(): void { screen = 'report'; }
```

(Confirm the existing `onNavigate` sends `{ type: 'navigate', index: ply }` — the Task-4 tests assert that exact shape. If the real `onNavigate` differs, use its actual command shape in the test assertions.)

(d) Replace the report render block:

```svelte
      {:else if screen === 'report' && rpt}
        <GameReportSummary report={rpt} {onStartReview} {onBackToAnalysis} {onNew} />
```

- [ ] **Step 5: Update `src/App.svelte` report-flow tests.** In `src/tests/App.test.ts`, the tests that do `fireEvent.click(screen.getByTestId('report-back'))` must now click `report-to-analysis` (same effect: returns to Analysis). Replace those `getByTestId('report-back')` occurrences with `getByTestId('report-to-analysis')`. (`report-panel` testid is unchanged, so those assertions still hold.)

- [ ] **Step 6: Remove dead code.** Delete `src/components/ReportPanel.svelte`. Check `AccuracyDial` usage: `grep -rn "AccuracyDial" src` — if only its own file remains, delete `src/components/AccuracyDial.svelte`. Delete any `ReportPanel.test.ts` / `AccuracyDial.test.ts` that now import a removed file. (`EvalGraph` and `MoveHistory` stay — reused.)

- [ ] **Step 7: Run tests** — `npx vitest run src/tests/GameReportSummary.test.ts src/tests/App.test.ts && npm run check` → PASS, 0/0. Then `npx vitest run` → all green.

- [ ] **Step 8: Commit**

```bash
git add src/components/GameReportSummary.svelte src/tests/GameReportSummary.test.ts src/App.svelte src/tests/App.test.ts
git rm src/components/ReportPanel.svelte
git commit -m "feat(report): chess.com-style Game Report summary + header nav (right icon to analysis)"
# (include: git rm src/components/AccuracyDial.svelte and any removed tests if they were orphaned)
```

---

## Task 4: Review screen — eval graph + move list + feedback + auto-play stepper

**Files:**
- Modify: `src/App.svelte`, `src/components/MoveHistory.svelte`
- Test: `src/tests/App.test.ts` (extend), `src/tests/MoveHistory.test.ts` (extend if present, else assert via App)

- [ ] **Step 1: Add `showBadges` to `src/components/MoveHistory.svelte`.** Add `import MoveBadge from './MoveBadge.svelte';` and `export let showBadges = false;`. Inside each move `<button>` (white and black), before the `{row.white.san}` / `{row.black.san}` text, add a badge when enabled and classified:

```svelte
            {#if showBadges && row.white.classification}<MoveBadge label={row.white.classification.label} size={13} />{/if}{row.white.san}
```
```svelte
            {#if showBadges && row.black.classification}<MoveBadge label={row.black.classification.label} size={13} />{/if}{row.black.san}
```
Default `showBadges = false` keeps the analysis screen's history unchanged.

- [ ] **Step 2: Write the failing test** — append a `describe('Review screen', ...)` to `src/tests/App.test.ts`. It reuses the existing `App report flow` helpers (`st()`, `baseReport`, `stateStore`, `reportStore`, `sendMock`). Reaching the report screen then Start Review must show a review card and navigate to ply 0; Back returns to report; the analysis icon returns to analysis; the play button toggles.

```ts
  it('Start Review opens the review screen, navigates to ply 0, and Back returns to the summary', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Explore'));
    stateStore.set(st([P1]));
    reportStore.set({ ...baseReport, plies: [RP1] });
    await Promise.resolve();
    // On the summary now:
    expect(screen.queryByTestId('report-panel')).toBeTruthy();
    sendMock.mockClear();
    await fireEvent.click(screen.getByTestId('start-review'));
    expect(screen.queryByTestId('review-card')).toBeTruthy();
    expect(sendMock).toHaveBeenCalledWith({ type: 'navigate', index: 0 }); // jumped to start
    await fireEvent.click(screen.getByTestId('review-back'));
    expect(screen.queryByTestId('report-panel')).toBeTruthy();             // back on summary
  });

  it('review play button toggles auto-play and sends navigate on tick', async () => {
    vi.useFakeTimers();
    render(App);
    await fireEvent.click(screen.getByText('Explore'));
    stateStore.set(st([P1, { ply: 2, san: 'e5', uci: 'e7e5', classification: null }]));
    reportStore.set({ ...baseReport, plies: [RP1, RP2] });
    await Promise.resolve();
    await fireEvent.click(screen.getByTestId('start-review'));
    sendMock.mockClear();
    await fireEvent.click(screen.getByTestId('autoplay'));                 // start playing
    await vi.advanceTimersByTimeAsync(1300);
    expect(sendMock).toHaveBeenCalledWith({ type: 'navigate', index: expect.any(Number) });
    await fireEvent.click(screen.getByTestId('autoplay'));                 // pause
    vi.useRealTimers();
  });
```

Note: `st()` sets `currentPly = moveList.length`. For the play test the second `st([...2 moves])` puts currentPly at 2 (= total); the play handler restarts from 0 when at the end, so a tick still fires a `navigate`. If your `st()` needs `currentPly` at 0 to observe a mid-game tick, pass a 2-move list and rely on the restart-from-end behavior (asserted loosely with `expect.any(Number)`).

- [ ] **Step 3: Run it — expect FAIL** (`review-card` not rendered): `npx vitest run src/tests/App.test.ts`

- [ ] **Step 4: Implement the Review screen in `src/App.svelte`.**

(a) Imports: `EvalGraph` is already imported (was used by `ReportPanel`? no — it was imported inside ReportPanel). Add at the top with the other component imports: `import EvalGraph from './components/EvalGraph.svelte';` and `import MoveStepper from './components/MoveStepper.svelte';`. Also ensure `import { onDestroy } from 'svelte';` is present (add if missing).

(b) Auto-play state + handlers (near the other functions):

```ts
  let playing = false;
  let playTimer: ReturnType<typeof setInterval> | null = null;
  function stopPlay(): void { playing = false; if (playTimer) { clearInterval(playTimer); playTimer = null; } }
  function togglePlay(): void {
    if (playing) { stopPlay(); return; }
    const total = s?.moveList?.length ?? 0;
    if ((s?.currentPly ?? 0) >= total) send({ type: 'navigate', index: 0 }); // restart from start
    playing = true;
    playTimer = setInterval(() => {
      const total2 = s?.moveList?.length ?? 0;
      const cur = s?.currentPly ?? 0;
      if (cur >= total2) { stopPlay(); return; }
      send({ type: 'navigate', index: cur + 1 });
    }, 1200);
  }
  // Manual navigation in review pauses auto-play, then navigates.
  function reviewNavigate(ply: number): void { stopPlay(); onNavigate(ply); }
  onDestroy(stopPlay);
```

(c) Reactives (near the other `$:` lines): compute the graph series and stop auto-play when leaving review:

```ts
  $: reviewWins = rpt ? [rpt.startWin, ...rpt.plies.map((p) => p.winWhite)] : [];
  $: if (screen !== 'review' && playing) stopPlay();
```

(d) Add the review render branch right after the report branch:

```svelte
      {:else if screen === 'review' && rpt}
        <section class="card" data-testid="review-card">
          <div class="pbar">
            <button type="button" class="back" data-testid="review-back" aria-label="Back to game report" on:click={onReviewBack}>←</button>
            <span class="ptitle">Game Review</span>
          </div>
          <div class="sec">
            <p class="glabel">Evaluation · white winning chances</p>
            <EvalGraph wins={reviewWins} currentPly={s?.currentPly ?? 0} onNavigate={reviewNavigate} />
          </div>
          {#if s?.lastMove || s?.annotating}
            <div class="sec" data-testid="feedback-section">
              <div class="bd">
                <MoveFeedback lastMove={s?.lastMove ?? null}
                  evaluating={s?.annotating && (s?.currentPly ?? 0) >= 1 ? { san: s.moveList[s.currentPly - 1]?.san ?? '' } : null}
                  onPlayBest={(uci) => send({ type: 'play_best', uci })}
                  gameOver={s?.gameOver ?? null} />
              </div>
            </div>
          {/if}
          <div class="sec grow">
            <MoveHistory moveList={s?.moveList ?? []} currentPly={s?.currentPly ?? 0} onNavigate={reviewNavigate} showBadges />
          </div>
          <div class="sec">
            <MoveStepper currentPly={s?.currentPly ?? 0} total={s?.moveList?.length ?? 0}
              onNavigate={reviewNavigate} {playing} onTogglePlay={togglePlay} />
          </div>
        </section>
```

(e) Add the review card's header styles to `App.svelte`'s `<style>` (the analysis card already provides `.card/.sec/.grow/.bd`; add the panel-bar + graph-label rules if not already present):

```css
  .pbar { display: flex; align-items: center; gap: 10px; padding: 11px 15px; border-bottom: 1px solid var(--keyline); }
  .back { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--keyline-2);
    border-radius: 7px; background: var(--paper-2); color: var(--ink-2); font-size: 15px; cursor: pointer; }
  .back:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .ptitle { font-family: var(--mono); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2); font-weight: 700; }
  .glabel { font-family: var(--mono); font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 7px; }
```
(If `npm run check` reports any of these selectors as unused because they already exist elsewhere in the file, keep the existing ones and drop the duplicate.)

- [ ] **Step 5: Run tests** — `npx vitest run src/tests/App.test.ts src/tests/MoveHistory.test.ts && npm run check` → PASS, 0/0. Then `npx vitest run` → all green.

- [ ] **Step 6: Commit**

```bash
git add src/App.svelte src/components/MoveHistory.svelte src/tests/App.test.ts
git commit -m "feat(review): review screen (eval graph + badged move list + feedback + auto-play stepper)"
```

---

## Final verification

- [ ] **Full suite** — `npx vitest run` → all green.
- [ ] **Typecheck + svelte-check** — `npm run check` → 0 errors, 0 warnings.
- [ ] **Manual desktop smoke (human gate)** — `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`:
  1. Load a PGN → Start → **Computer analysis** → the **Game Report** summary shows (rosette + "Game Review", two players with accuracy, all 10 category rows with badges + counts, **New** + **Start Review**).
  2. Click the **right analysis icon** → returns to Analysis.
  3. Re-open the report → **Start Review** → the **Review** screen: eval graph up top (click a point to jump), a **badged move list** (click a move to jump), the per-move feedback card, and the stepper with a **play** button between the arrows.
  4. Click **play** → auto-advances move by move; the icon becomes **pause**; clicking a move or an arrow pauses it; it stops at the last move.
  5. **Back (‹)** → returns to the Game Report summary.
  6. PGN with `[White "X"] [Black "Y"]` headers shows those names; a captured/played game shows "White"/"Black".

---

## Self-review notes (author)

- **Spec coverage:** 10-count data + names (T1) · summary panel + header nav, rating/phases dropped (T3) · Review screen with eval graph moved to top, badged move list, feedback, and play/pause auto-play (T2 stepper + T4) · Book row shown though it reads 0 until a book is wired (noted in spec). All spec sections mapped.
- **Reuse:** `MoveBadge`/`glyphs.ts` (badges), `MoveHistory` (move list), `EvalGraph`, `MoveFeedback`, the `navigate`/`play_best` commands, the live-annotation before-pass — all reused. New code = one pure aggregation helper, two small components (`MoveStepper`, `GameReportSummary`), and the review composition + auto-play.
- **Type consistency:** count keys (`brilliant…miss`) are identical across `PlayerReportDto`, `ClassCounts`, the `CATS` list, and the `MoveBadge` `label`; `perSideClassCounts` returns `{white,black}` used directly by `_buildReport`; `reviewNavigate` (pauses + navigates) is used by EvalGraph/MoveHistory/MoveStepper while the auto-play timer sends `navigate` directly.
- **Known-minor / verify-in-manual:** auto-play cadence 1200 ms; the play test asserts a tick loosely (`expect.any(Number)`) because `st()` seeds `currentPly` at the list end; confirm smooth stepping + clean stop/pause in the desktop smoke. Book count = 0 until `book.ts` is wired into `_buildReport` (optional follow-up).
```
