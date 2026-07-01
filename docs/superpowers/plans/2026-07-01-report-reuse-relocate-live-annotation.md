# Report reuse + relocated trigger + live per-move annotation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Request computer analysis" reuse an existing report (no re-run) and live in the bottom action bar as a state-aware icon button, and annotate the single move you land on while stepping through a game before running the full batch.

**Architecture:** Three feature areas over the existing PGN-report code. (A) App decides reuse-vs-analyze by comparing the cached report's ply UCIs to the board's move list. (B/E1/E2) the trigger moves into `ActionBar` with Request/View/Cancel states, disabled when no game. (C/E3/E4) the orchestrator gains a non-blocking `_annotate` before-pass that evaluates the position before the current move, reuses the existing `_pending`/`_onUpdate` classify path to badge that move, debounced ~150 ms; an `annotating` flag drives an "Evaluating…" hint in the move-feedback area.

**Tech Stack:** TypeScript, Svelte, Vitest, @testing-library/svelte, chessops, native Stockfish / stockfish.wasm.

**Spec:** `docs/superpowers/specs/2026-07-01-report-reuse-relocate-live-annotation-design.md`

**Conventions:**
- All commands run from `frontend/`.
- Single file test: `npx vitest run src/tests/<file>.test.ts`. Typecheck: `npm run check`. Full: `npx vitest run`.
- Follow existing component/orchestrator patterns. TDD: test first, watch it fail, implement, watch it pass, commit.

---

## File Structure

**Modify:**
- `src/App.svelte` — Part A (`onRequestAnalysis` reuse + `reportMatchesGame`), Part B (remove in-body trigger; pass trigger props to `ActionBar`), E1 (`hasReportForGame`), E4 (feedback-section condition + `evaluating` prop).
- `src/components/ActionBar.svelte` — Part B + E1 + E2 (Request/View/Cancel/progress in the `.acts` row; disabled-when-empty; `BarChart` icon).
- `src/components/MoveFeedback.svelte` — E4 (`evaluating` prop + pending row with animated "Evaluating…").
- `src/core/orchestrator.ts` — Part C (`_annotate` before-pass, `navigate`, `_onUpdate`/`_onSearchDone` interception, terminal edge), E3 (debounce), E4 (`_annotating` flag emitted on the state frame).
- `src/lib/types.ts` — E4 (`annotating: boolean` on `StateFrame`).
- `src/tests/engineClient.test.ts` — add `annotating: false` to the one `StateFrame` literal.

**Create:**
- `src/tests/ActionBar.test.ts`, `src/tests/MoveFeedback.test.ts`, `src/tests/orchestratorAnnotate.test.ts`.

---

## Task 1: Part A — reuse the report on Request

**Files:**
- Modify: `src/App.svelte`
- Test: `src/tests/App.test.ts` (extend the existing `App report flow` describe)

- [ ] **Step 1: Write the failing test**

Extend the `engineClient` import at the top of `src/tests/App.test.ts` to also import the `state` store:

```ts
import { send, report as reportStore, state as stateStore } from '../lib/engineClient';
```

Append inside the existing `describe('App report flow', ...)` block (the file already imports `render, fireEvent, screen`, mocks `send`, and has `sendMock`). Add a `st()` helper (a realistic game must be on the board — an empty game can't be analyzed, and E2 in Task 2 disables the trigger at `total===0`, so the reuse path always has ≥1 move):

```ts
  // Minimal StateFrame carrying a given move list; other fields are sensible defaults.
  function st(moveList: { ply: number; san: string; uci: string; classification: null }[]): import('../lib/types').StateFrame {
    return {
      type: 'state', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      sideToMove: 'white', engineId: 'stockfish', analyzing: false, eval: null, depth: 0, lines: [],
      lastMove: null, visionStatus: 'idle', detectedOrientation: null, lowConfidence: [], region: null,
      moveList, currentPly: moveList.length, analysisEnabled: true, movetime: null,
      reportProgress: null, gameOver: null,
    };
  }
  const P1 = { ply: 1, san: 'e4', uci: 'e2e4', classification: null };
  const RP1 = { ply: 1, san: 'e4', uci: 'e2e4', winWhite: 53, cpl: 0, classification: null };
  const RP2 = { ply: 2, san: 'e5', uci: 'e7e5', winWhite: 50, cpl: 0, classification: null };
  const baseReport = { white: { accuracy: 90, acpl: 20, inaccuracy: 0, mistake: 0, blunder: 0 },
                       black: { accuracy: 80, acpl: 30, inaccuracy: 0, mistake: 0, blunder: 0 }, startWin: 51 };

  it('reopens an existing matching report on Request without re-analyzing', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Explore'));
    stateStore.set(st([P1]));                                   // 1-move game on the board
    reportStore.set({ ...baseReport, plies: [RP1] });           // report matches that game
    await Promise.resolve();
    await fireEvent.click(screen.getByTestId('report-back'));   // it auto-switched; return to analysis
    sendMock.mockClear();
    await fireEvent.click(screen.getByTestId('request-analysis'));
    expect(screen.queryByTestId('report-panel')).toBeTruthy();     // reopened
    expect(sendMock).not.toHaveBeenCalledWith({ type: 'analyze_game' }); // no re-run
  });

  it('re-analyzes when the cached report does not match the current game', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Explore'));
    stateStore.set(st([P1]));                                   // board has 1 move…
    reportStore.set({ ...baseReport, plies: [RP1, RP2] });      // …but the report is for a 2-move game
    await fireEvent.click(screen.getByTestId('report-back'));
    sendMock.mockClear();
    await fireEvent.click(screen.getByTestId('request-analysis'));
    expect(sendMock).toHaveBeenCalledWith({ type: 'analyze_game' });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/App.test.ts`
Expected: FAIL — the first test still sends `analyze_game` (current `onRequestAnalysis` always does).

- [ ] **Step 3: Implement the reuse in `src/App.svelte`**

Add a helper near the other functions (after `lastReport` is declared) and replace `onRequestAnalysis`:

```ts
function reportMatchesGame(
  r: import('./lib/types').GameReportDto,
  st: import('./lib/types').StateFrame | null,
): boolean {
  const a = r.plies.map((p) => p.uci);
  const b = (st?.moveList ?? []).map((m) => m.uci);
  return a.length === b.length && a.every((u, i) => u === b[i]);
}

function onRequestAnalysis(): void {
  if (rpt && reportMatchesGame(rpt, s)) { screen = 'report'; return; }
  send({ type: 'analyze_game' });
}
```

(`rpt` = `$report` and `s` = `$state` already exist as reactive aliases. Keep the existing `onCancelAnalysis`/`onReportBack`/`onNew` unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/App.test.ts && npm run check`
Expected: PASS; `check` 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte src/tests/App.test.ts
git commit -m "feat(report): Request reuses a matching cached report instead of re-analyzing"
```

---

## Task 2: Part B + E1 + E2 — relocate the trigger into the action bar

**Files:**
- Modify: `src/components/ActionBar.svelte`
- Modify: `src/App.svelte`
- Test: `src/tests/ActionBar.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `src/tests/ActionBar.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ActionBar from '../components/ActionBar.svelte';

describe('ActionBar trigger', () => {
  it('shows "Request computer analysis" by default and calls onRequestAnalysis', async () => {
    const onRequestAnalysis = vi.fn();
    const { getByTestId, getByText } = render(ActionBar, {
      props: { currentPly: 0, total: 4, onRequestAnalysis, reportProgress: null, hasReportForGame: false },
    });
    expect(getByText('Request computer analysis')).toBeTruthy();
    await fireEvent.click(getByTestId('request-analysis'));
    expect(onRequestAnalysis).toHaveBeenCalled();
  });

  it('shows "View game report" when a matching report exists', () => {
    const { getByText } = render(ActionBar, {
      props: { currentPly: 0, total: 4, hasReportForGame: true, reportProgress: null },
    });
    expect(getByText('View game report')).toBeTruthy();
  });

  it('shows Cancel + progress while a batch runs', async () => {
    const onCancelAnalysis = vi.fn();
    const { getByTestId } = render(ActionBar, {
      props: { currentPly: 0, total: 4, reportProgress: { done: 2, total: 5 }, onCancelAnalysis },
    });
    const cancel = getByTestId('analysis-progress');
    await fireEvent.click(cancel.querySelector('button')!);
    expect(onCancelAnalysis).toHaveBeenCalled();
  });

  it('disables the trigger when there is no game (total 0)', () => {
    const { getByTestId } = render(ActionBar, {
      props: { currentPly: 0, total: 0, hasReportForGame: false, reportProgress: null },
    });
    expect((getByTestId('request-analysis') as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/ActionBar.test.ts`
Expected: FAIL — no `request-analysis`/`analysis-progress` in ActionBar yet.

- [ ] **Step 3: Update `src/components/ActionBar.svelte`**

Replace the whole file with:

```svelte
<script lang="ts">
  import Icon from './Icon.svelte';
  export let currentPly: number = 0;
  export let total: number = 0;
  export let onNavigate: (ply: number) => void = () => {};
  export let onNew: () => void = () => {};
  export let onRequestAnalysis: () => void = () => {};
  export let onCancelAnalysis: () => void = () => {};
  export let reportProgress: { done: number; total: number } | null = null;
  export let hasReportForGame = false;

  $: pct = reportProgress ? Math.round((reportProgress.done / reportProgress.total) * 100) : 0;
</script>

<div class="nav">
  <button type="button" class="navbtn" title="First move"
    on:click={() => onNavigate(0)}><Icon name="JumpFirst" /></button>
  <button type="button" class="navbtn" title="Previous move"
    on:click={() => onNavigate(currentPly - 1)}><Icon name="JumpPrev" /></button>
  <button type="button" class="navbtn" title="Next move"
    on:click={() => onNavigate(currentPly + 1)}><Icon name="JumpNext" /></button>
  <button type="button" class="navbtn" title="Last move"
    on:click={() => onNavigate(total)}><Icon name="JumpLast" /></button>
</div>

{#if reportProgress}
  <div class="analyzing" data-testid="analysis-progress">
    <div class="bar"><div class="fill" style="width:{pct}%"></div></div>
    <button type="button" class="cancel" on:click={onCancelAnalysis}>Cancel · {reportProgress.done}/{reportProgress.total}</button>
  </div>
{/if}

<div class="acts">
  {#if !reportProgress}
    <button type="button" class="act" data-testid="request-analysis"
      disabled={total === 0} on:click={onRequestAnalysis}>
      <span class="ic"><Icon name="BarChart" /></span>{hasReportForGame ? 'View game report' : 'Request computer analysis'}
    </button>
  {/if}
  <button type="button" class="act" on:click={onNew}><span class="ic"><Icon name="Reload" /></span>New</button>
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
  .analyzing { display: flex; flex-direction: column; gap: 8px; padding: 2px 16px 6px; }
  .bar { height: 8px; border-radius: 5px; background: var(--keyline); overflow: hidden; }
  .fill { height: 100%; background: var(--green); transition: width .2s; }
  .cancel { align-self: center; padding: 6px 12px; border: 1px solid var(--keyline-2); border-radius: 7px;
    background: var(--paper-2); font-family: var(--mono); font-size: 11px; color: var(--ink-2); cursor: pointer; }
  .acts { display: flex; justify-content: center; gap: 8px; padding: 4px 12px 14px; }
  .act {
    display: flex; align-items: center; gap: 8px; padding: 10px 18px;
    font-family: var(--sans); font-weight: 600; font-size: 13.5px; color: var(--ink-2);
    background: transparent; border: none; border-radius: 9px; cursor: pointer; transition: .14s;
  }
  .act:hover:not(:disabled) { color: var(--green); background: var(--paper-2); }
  .act:disabled { color: var(--ink-faint); cursor: default; }
  .act .ic { font-size: 15px; }
</style>
```

- [ ] **Step 4: Remove the old trigger block and wire ActionBar in `src/App.svelte`**

Delete the entire `<!-- 2. Request-computer-analysis trigger / progress bar -->` `<div class="sec">…</div>` block from the analysis card.

Add a reactive near the other `$:` lines:

```ts
$: hasReportForGame = !!(rpt && reportMatchesGame(rpt, s));
```

Replace the `<ActionBar ... />` element (section 5) with:

```svelte
<ActionBar currentPly={s?.currentPly ?? 0} total={s?.moveList?.length ?? 0}
  {onNavigate} onNew={onNew}
  onRequestAnalysis={onRequestAnalysis} onCancelAnalysis={onCancelAnalysis}
  reportProgress={progress} {hasReportForGame} />
```

Remove the now-unused `.request`/`.analyzing`/`.bar`/`.fill`/`.cancel` CSS rules from `App.svelte`'s `<style>` block if they are no longer referenced (they moved into ActionBar). Leave any that are still used elsewhere.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/tests/ActionBar.test.ts src/tests/App.test.ts && npm run check`
Expected: PASS (the App `report flow` tests still find `request-analysis`, now inside ActionBar); `check` 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/components/ActionBar.svelte src/App.svelte src/tests/ActionBar.test.ts
git commit -m "feat(report): relocate trigger into ActionBar (Request/View/Cancel states, disabled when empty)"
```

---

## Task 3: E4 infra + UI — the "Evaluating…" hint (live-played moves)

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/core/orchestrator.ts`
- Modify: `src/components/MoveFeedback.svelte`
- Modify: `src/App.svelte`
- Modify: `src/tests/engineClient.test.ts`
- Test: `src/tests/MoveFeedback.test.ts` (new); `src/tests/orchestratorAnnotate.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/tests/MoveFeedback.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MoveFeedback from '../components/MoveFeedback.svelte';

describe('MoveFeedback evaluating hint', () => {
  it('shows "<san> was played" + Evaluating… when a badge is pending', () => {
    const { getByText, getByTestId } = render(MoveFeedback, {
      props: { lastMove: null, evaluating: { san: 'd3' } },
    });
    expect(getByTestId('evaluating')).toBeTruthy();
    expect(getByText(/d3 was played/)).toBeTruthy();
    expect(getByText(/Evaluating/)).toBeTruthy();
  });

  it('renders nothing when neither lastMove nor evaluating is set', () => {
    const { queryByTestId } = render(MoveFeedback, { props: { lastMove: null, evaluating: null } });
    expect(queryByTestId('evaluating')).toBeNull();
    expect(queryByTestId('movefeedback')).toBeNull();
  });
});
```

Create `src/tests/orchestratorAnnotate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../core/orchestrator';
import type { ServerFrame, StateFrame } from '../lib/types';
import type { AnalysisInfo } from '../engine/types';
import type { SessionCallbacks } from '../engine/session';

// Session that answers each start(fen) with a scripted eval (best move a2a3, depth 20).
function scriptedFactory(cpForFen: (fen: string) => number) {
  return (_e: unknown, cb: SessionCallbacks) => ({
    start(fen: string) {
      queueMicrotask(() => {
        cb.onUpdate({ fen, depth: 20, lines: [{ multipv: 1, eval: { cp: cpForFen(fen), mate: null }, depth: 20, pv: ['a2a3'] }] } as AnalysisInfo);
        cb.onDone?.();
      });
    },
    stop() {}, dispose() {},
  });
}
function mk(cpForFen: (fen: string) => number = () => 20) {
  const frames: ServerFrame[] = [];
  const engine = { select: vi.fn(), setOption: vi.fn() };
  const orch = new Orchestrator((f) => frames.push(f), { engine, sessionFactory: scriptedFactory(cpForFen), analysisEnabled: true });
  const states = () => frames.filter((f): f is StateFrame => f.type === 'state');
  const last = () => states().at(-1)!;
  return { orch, frames, states, last };
}
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe('annotating flag on live-played moves', () => {
  it('is true right after a move is played and false once it is classified', async () => {
    const { orch, states, last } = mk();
    orch.handle({ type: 'set_analysis_enabled', enabled: true }); // kick off analysis (constructor does not)
    await drain();                                   // start position analyzed -> beforeA available
    orch.handle({ type: 'make_move', uci: 'e2e4' }); // pending set
    expect(last().annotating).toBe(true);            // hint shows while classifying
    await drain();                                   // engine analyzes new pos -> classify
    expect(last().annotating).toBe(false);
    expect(last().moveList[0].classification).not.toBeNull();
    // sanity: at least one emitted frame carried annotating=true
    expect(states().some((s) => s.annotating)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/MoveFeedback.test.ts src/tests/orchestratorAnnotate.test.ts`
Expected: FAIL — `evaluating` prop not handled; `annotating` not on the state frame.

- [ ] **Step 3a: Add `annotating` to `StateFrame` in `src/lib/types.ts`**

In the `StateFrame` interface, next to `reportProgress`, add:

```ts
  annotating: boolean;
```

- [ ] **Step 3b: Add the `_annotating` flag in `src/core/orchestrator.ts`**

Add the field with the other analysis/classify state (near `_pending`):

```ts
  _annotating = false;
```

In `_stateFrame()`'s returned object (next to `reportProgress: this._reportProgress,`), add:

```ts
      annotating: this._annotating,
```

In `_resetMoveState()`, add `this._annotating = false;`.

In `_playMove(...)`, update the terminal/else branch so it maintains `_annotating` (the `bestLine`/`lineMove` helpers are already imported and used elsewhere in this file):

```ts
    if (outcomeOf(this._board) !== null) {
      this._pending = null;
      this._annotating = false;
      this._classifyTerminal(boardBefore, uci, beforeA, this._cursor - 1);
    } else {
      this._pending = [boardBefore, uci, beforeA, this._cursor - 1];
      const blB = beforeA !== null ? bestLine(beforeA) : null;
      this._annotating = blB !== null && lineMove(blB) !== null; // only if a badge can actually resolve
    }
```

In `_onUpdate`, in the existing classify block, set `_annotating = false` when the pending request is consumed. Change the `this._pending = null;` line at the end of that block to:

```ts
      this._pending = null;
      this._annotating = false;
```

- [ ] **Step 3c: Fix `StateFrame` object literals broken by the new required field**

`annotating` is now required on `StateFrame`, so every hand-built literal must set it. Add `annotating: false,` to:
- the inline `StateFrame` literal in `src/tests/engineClient.test.ts` (near its `reportProgress: null,`), and
- the `st()` helper in `src/tests/App.test.ts` (added in Task 1, near its `reportProgress: null,`).

Run `npm run check` after 3a–3b to let the compiler point out any other literal that needs it, and fix each the same way.

- [ ] **Step 3d: Add the `evaluating` branch to `src/components/MoveFeedback.svelte`**

Add the prop in `<script>`:

```ts
  export let evaluating: { san: string } | null = null;
```

Immediately after the closing `{/if}` of the existing `{#if lastMove} … {/if}` block, add:

```svelte
{#if !lastMove && evaluating}
  <div class="lm" data-testid="evaluating">
    <div class="mrow">
      <span class="mtext">
        <span class="mname"><span class="san">{evaluating.san}</span> <span class="desc">was played</span></span>
      </span>
    </div>
    <div class="evaluating">Evaluating<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>
  </div>
{/if}
```

Add to the `<style>` block:

```css
  .evaluating { padding: 2px 8px 6px; font-family: var(--mono); font-size: 11px; letter-spacing: .1em;
    text-transform: uppercase; color: var(--ink-faint); }
  .evaluating .dots span { animation: blink 1.2s infinite both; }
  .evaluating .dots span:nth-child(2) { animation-delay: .2s; }
  .evaluating .dots span:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: .2; } 40% { opacity: 1; } }
```

- [ ] **Step 3e: Wire the hint in `src/App.svelte`**

Change the feedback-section condition and pass `evaluating`:

```svelte
{#if viewPrefs.feedback && analysisEnabled && (s?.lastMove || s?.annotating)}
  <div class="sec" data-testid="feedback-section">
    <div class="bd">
      <MoveFeedback lastMove={s?.lastMove ?? null}
        evaluating={s?.annotating && (s?.currentPly ?? 0) >= 1 ? { san: s.moveList[s.currentPly - 1]?.san ?? '' } : null}
        onPlayBest={(uci) => send({ type: 'play_best', uci })}
        gameOver={s?.gameOver ?? null} />
    </div>
  </div>
{/if}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/MoveFeedback.test.ts src/tests/orchestratorAnnotate.test.ts src/tests/engineClient.test.ts && npm run check`
Expected: PASS; `check` 0 errors, 0 warnings. Then `npx vitest run` — all green (any other `StateFrame` literal the compiler flags gets `annotating: false`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/core/orchestrator.ts src/components/MoveFeedback.svelte src/App.svelte src/tests/engineClient.test.ts src/tests/MoveFeedback.test.ts src/tests/orchestratorAnnotate.test.ts
git commit -m "feat(report): annotating flag + Evaluating… hint in the move-feedback area"
```

---

## Task 4: Part C + E3 — live per-move annotation while navigating (debounced)

**Files:**
- Modify: `src/core/orchestrator.ts`
- Test: `src/tests/orchestratorAnnotate.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `src/tests/orchestratorAnnotate.test.ts`:

```ts
describe('live annotation while navigating', () => {
  it('classifies the move you land on (jump) after the debounce', async () => {
    vi.useFakeTimers();
    const { orch, last } = mk();
    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' }); // 4 plies, none classified
    orch.handle({ type: 'navigate', index: 2 });                     // jump onto move 2 (…e5)
    expect(last().annotating).toBe(true);                            // hint shows immediately
    await vi.advanceTimersByTimeAsync(200);                          // fire the ~150ms debounce
    for (let i = 0; i < 30; i++) { await Promise.resolve(); }        // drain the before+after evals
    expect(last().moveList[1].classification).not.toBeNull();        // move 2 got a badge
    expect(last().annotating).toBe(false);
    vi.useRealTimers();
  });

  it('does nothing at index 0, when already classified, or when analysis is off', async () => {
    vi.useFakeTimers();
    // analysis OFF
    const framesOff: ServerFrame[] = [];
    const engineOff = { select: vi.fn(), setOption: vi.fn() };
    const off = new Orchestrator((f) => framesOff.push(f), { engine: engineOff, sessionFactory: scriptedFactory(() => 20), analysisEnabled: false });
    off.handle({ type: 'load_pgn', pgn: '1. e4 e5 *' });
    off.handle({ type: 'navigate', index: 1 });
    const lastOff = () => framesOff.filter((f): f is StateFrame => f.type === 'state').at(-1)!;
    expect(lastOff().annotating).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(lastOff().moveList[0].classification).toBeNull();

    // index 0 (base) with analysis ON -> nothing to annotate
    const { orch, last } = mk();
    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 *' });
    orch.handle({ type: 'navigate', index: 0 });
    expect(last().annotating).toBe(false);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/orchestratorAnnotate.test.ts`
Expected: FAIL — navigating never classifies (no before-pass yet); `annotating` stays false on navigate.

- [ ] **Step 3a: Add the annotate state + debounce constant to `src/core/orchestrator.ts`**

Near the top with the other module constants (e.g. beside `CLASSIFY_MIN_DEPTH`):

```ts
const ANNOTATE_DEBOUNCE_MS = 150;
```

Add fields next to `_annotating`:

```ts
  _annotate: { boardBefore: Chess; uci: string; ply: number; latest: AnalysisInfo | null } | null = null;
  private _annotateTimer: ReturnType<typeof setTimeout> | null = null;
```

- [ ] **Step 3b: Add helpers to `src/core/orchestrator.ts`**

Add these private methods (near `_rebuildBoard` / `_restart`):

```ts
  private _boardAt(cursor: number): Chess {
    return this._history.slice(0, cursor).reduce((p, e) => playUci(p, e.move), posFromFen(this._baseFen));
  }

  private _cancelAnnotate(): void {
    if (this._annotateTimer !== null) { clearTimeout(this._annotateTimer); this._annotateTimer = null; }
    this._annotate = null;
  }

  private _startAnnotate(index: number): void {
    if (index < 1 || index > this._history.length) { this._annotating = false; return; }
    if (this._history[index - 1].classification !== undefined) { this._annotating = false; return; }
    const boardBefore = this._boardAt(index - 1);
    this._annotate = { boardBefore, uci: this._history[index - 1].move, ply: index - 1, latest: null };
    // Evaluate the BEFORE position silently (its lines are not displayed).
    this._session.stop();
    this._session.start(fenOf(boardBefore), { depth: this._depth, timeMs: this._movetimeMs });
  }

  private _finishAnnotate(): void {
    const a = this._annotate;
    if (a === null) return;
    const beforeA = a.latest;
    this._annotate = null;
    const blBefore = beforeA !== null ? bestLine(beforeA) : null;
    if (beforeA === null || blBefore === null || lineMove(blBefore) === null) {
      // No usable before-eval: give up quietly and just analyze the current position.
      this._annotating = false;
      this._session.stop();
      this._restart();
      return;
    }
    if (outcomeOf(this._board) !== null) {
      // Current position is terminal: classify against a synthetic eval (no engine).
      this._classifyTerminal(a.boardBefore, a.uci, beforeA, a.ply);
      this._annotating = false;
      this._session.stop();
      this._send(this._stateFrame(this._lastAnalysis));
      return;
    }
    // Hand off to the existing classify path: analyze the current position; _onUpdate
    // classifies the move (and clears _annotating) once it reaches CLASSIFY_MIN_DEPTH.
    this._pending = [a.boardBefore, a.uci, beforeA, a.ply];
    this._session.stop();
    this._restart();
  }
```

- [ ] **Step 3c: Update `navigate` in `src/core/orchestrator.ts`**

Replace the `navigate` method with:

```ts
  navigate(index: number): void {
    this._session.stop();
    this._cancelAnnotate();
    index = Math.max(0, Math.min(this._history.length, index));
    this._cursor = index;
    this._rebuildBoard();
    this._lastAnalysis = null;
    this._pending = null;
    this._preMoveAnalysis = index > 0 ? this._history[index - 1].preAnalysis ?? null : null;
    this._lastMove = index > 0 ? this._history[index - 1].lastMove ?? null : null;
    // Live per-move annotation: if the move we landed on isn't classified yet and we can
    // analyze, evaluate its before/after so its badge appears. Debounced so fast scrubbing
    // doesn't thrash the engine.
    const needsAnnotate =
      index >= 1 &&
      this._analysisEnabled &&
      this._history[index - 1].classification === undefined;
    this._annotating = needsAnnotate;
    this._restart(); // analyze the current position for display (emits a frame with annotating)
    if (needsAnnotate) {
      this._annotateTimer = setTimeout(() => {
        this._annotateTimer = null;
        this._startAnnotate(this._cursor);
      }, ANNOTATE_DEBOUNCE_MS);
    }
  }
```

Also call `this._cancelAnnotate();` at the start of `reset()` (after `this._session.stop();`) so a pending before-pass can't fire after a reset.

- [ ] **Step 3d: Intercept the annotate pass in the callbacks**

At the TOP of `_onUpdate`, AFTER the existing `_batch` check and BEFORE `this._lastAnalysis = info;`, add:

```ts
    if (this._annotate !== null) {
      this._annotate.latest = info;                       // capture the BEFORE eval
      if (info.depth >= CLASSIFY_MIN_DEPTH) this._finishAnnotate();
      return;                                             // do NOT display the before-position lines
    }
```

At the TOP of `_onSearchDone`, AFTER the existing `_batch` check, add:

```ts
    if (this._annotate !== null) { this._finishAnnotate(); return; }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/orchestratorAnnotate.test.ts && npm run check`
Expected: PASS; `check` 0 errors, 0 warnings. Then `npx vitest run` — all green (existing navigate/live-analysis and report tests unaffected: the annotate path only runs on an un-classified navigated move with analysis on, and never sets `_batch`).

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.ts src/tests/orchestratorAnnotate.test.ts
git commit -m "feat(report): live per-move annotation while navigating (debounced before-pass)"
```

---

## Final verification

- [ ] **Full test suite**

Run: `npx vitest run`
Expected: all green (existing + new).

- [ ] **Typecheck + svelte-check**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Manual desktop smoke (human gate)**

Run: `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`. Then:
1. Paste a PGN → Start → in Analysis, step through moves (Next / click the move list): each move you land on briefly shows "`<san>` was played / Evaluating…" in the feedback area, then its badge appears on the board and in the move list. Jumping to an arbitrary move also annotates it. Fast-arrowing does not thrash (the badge resolves once you settle).
2. Click **Request computer analysis** (now at the bottom next to **New**, with the bar-chart icon) → progress → Report screen.
3. Back → the bottom button now reads **View game report**; click it → reopens the report instantly (no re-analysis / no progress bar).
4. Play a diverging move or load a different PGN → the button reverts to **Request computer analysis**; clicking it runs a fresh batch.
5. With an empty board (no moves), the trigger is disabled.

---

## Self-review notes (author)

- **Spec coverage:** A (T1 reuse) · B/E1/E2 (T2 relocate + states + disable) · E4 infra+UI (T3 `annotating` + hint) · C/E3 (T4 before-pass + debounce). All spec sections mapped.
- **Type consistency:** `reportMatchesGame(GameReportDto, StateFrame|null)`; `hasReportForGame` prop name matches App→ActionBar; `annotating: boolean` on `StateFrame`; `evaluating: {san}` prop on `MoveFeedback`; `_annotate`/`_annotating`/`_annotateTimer` used consistently in the orchestrator.
- **Reuse of existing machinery:** the navigated-move classification reuses `_pending` + the `_onUpdate` classify block + `_classifyTerminal` (terminal edge); no duplicate classify logic. The before-pass uses `_annotate` (NOT `_batch`), so it never trips the mid-batch command guard and never blocks navigation.
- **Known-minor / verify-in-manual:** the before-pass shares the single session — the implementer must confirm the real session's `stop()`→`onDone` timing doesn't finalize `_annotate` prematurely (the scripted test session's `stop()` is a no-op so unit tests won't surface it; watch for it in the desktop smoke). Inline badges use live depth and are overwritten by the depth-18 batch when you run the full report.
