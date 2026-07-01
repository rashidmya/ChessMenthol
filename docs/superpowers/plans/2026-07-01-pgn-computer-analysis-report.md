# PGN Import + Lichess Computer-Analysis Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a PGN and produce a full-game "computer analysis" report with full Lichess-parity metrics (accuracy %, ACPL, ?!/?/?? counts, eval graph, on-board badges) on a dedicated Report screen, and make the board editor's PGN box reflect the current position live.

**Architecture:** chessops' PGN module (`chessops/pgn`) parses a PGN into a base FEN + mainline moves that load into the orchestrator's existing linear history. A new batch mode in the orchestrator drives the single engine over every ply (depth 18) to collect one eval per position; a pure `core/accuracy.ts` turns those evals into Lichess-parity numbers, and `core/classify.ts` gets its ?!/?/?? decision swapped to Lichess's winning-chances drop. A new Report screen renders dials, an SVG eval graph, counts, and a jump-to-ply move list; the board reuses `BoardBadge` per ply.

**Tech Stack:** TypeScript, Svelte, Vitest, chessops (`chessops/pgn`, `chessops/san`, `chessops/variant`), native Stockfish (Tauri sidecar) / stockfish.wasm.

**Spec:** `docs/superpowers/specs/2026-07-01-pgn-computer-analysis-report-design.md`

**Conventions:**
- All commands run from `frontend/`.
- Single-file test run: `npx vitest run src/tests/<file>.test.ts`.
- Typecheck: `npm run check`. Full tests: `npm test`.
- New source in `src/core`, `src/components`, `src/lib`; new tests in `src/tests`.
- `core/pgn.ts` and `core/accuracy.ts` are pure; `core/pgn.ts` is the SECOND sanctioned chessops-importing wrapper (alongside `core/chess.ts`).

---

## File Structure

**Create:**
- `src/core/pgn.ts` — PGN parse/build wrapper over `chessops/pgn`. `parseGame`, `makePositionPgn`, `looksLikePgn`.
- `src/core/accuracy.ts` — pure Lichess-parity math: Win%, per-move accuracy, game accuracy, ACPL + Maths helpers.
- `src/components/EvalGraph.svelte` — SVG win% area chart with a ply marker; click → navigate.
- `src/components/AccuracyDial.svelte` — SVG ring showing a player's accuracy %.
- `src/components/ReportPanel.svelte` — the Report screen's right-panel card (dials, counts, graph, reused move list, nav).
- Tests: `src/tests/pgn.test.ts`, `src/tests/accuracy.test.ts`, `src/tests/orchestratorReport.test.ts`, `src/tests/EvalGraph.test.ts`, `src/tests/AccuracyDial.test.ts`, `src/tests/ReportPanel.test.ts`, `src/tests/editorPgn.test.ts`.

**Modify:**
- `src/core/chess.ts` — update the wrapper-note comment to name `core/pgn.ts`.
- `src/core/classify.ts` — swap ?!/?/?? to winning-chances drop + mate branch (keep the rest).
- `src/core/orchestrator.ts` — `loadPgn`, `analyzeGame`, `cancelAnalysis`, `_batch`, report build.
- `src/lib/types.ts` — `load_pgn`/`analyze_game`/`cancel_analysis` commands; `GameReportDto`/`PlyReportDto`/`PlayerReportDto`; `ReportFrame`; `reportProgress` on `StateFrame`.
- `src/lib/engineClient.ts` — `report` + `reportProgress` stores; route `ReportFrame`.
- `src/components/EditPanel.svelte` — no code change needed (prop exists); covered by the editor-PGN test.
- `src/App.svelte` — reactive `editPgn`; `'report'` screen; Request-analysis button + progress; wire Home PGN routing.
- `src/tests/classify.test.ts` — rewrite the ?!/?/?? band assertions to Lichess expectations.

---

## Phase A — PGN I/O

### Task 1: `core/pgn.ts` — `makePositionPgn` + `looksLikePgn`

**Files:**
- Create: `src/core/pgn.ts`
- Test: `src/tests/pgn.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/pgn.test.ts
import { describe, it, expect } from 'vitest';
import { makePositionPgn, looksLikePgn } from '../core/pgn';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('makePositionPgn', () => {
  it('emits a plain seven-tag roster for the standard start (no SetUp/FEN)', () => {
    const pgn = makePositionPgn(START);
    expect(pgn).toContain('[Event ');
    expect(pgn).not.toContain('[FEN ');
    expect(pgn).not.toContain('[SetUp ');
  });

  it('emits SetUp + FEN tags for a non-standard position', () => {
    const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    const pgn = makePositionPgn(fen);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${fen}"]`);
  });
});

describe('looksLikePgn', () => {
  it('detects a tag header', () => {
    expect(looksLikePgn('[Event "x"]\n\n1. e4 e5 *')).toBe(true);
  });
  it('detects a move-number movetext with no headers', () => {
    expect(looksLikePgn('1. e4 e5 2. Nf3 Nc6 *')).toBe(true);
  });
  it('treats a bare FEN as not-PGN', () => {
    expect(looksLikePgn(START)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/pgn.test.ts`
Expected: FAIL — "Failed to resolve import '../core/pgn'".

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/core/pgn.ts
/**
 * core/pgn.ts — the SECOND sanctioned chessops-facing wrapper (alongside
 * core/chess.ts). Wraps chessops/pgn + chessops/san + chessops/variant so the
 * PGN API never leaks into the rest of the app.
 */
import { makePgn, parsePgn, defaultHeaders, startingPosition, type PgnNodeData, type Game } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeFen } from 'chessops/fen';
import { makeUci } from 'chessops/util';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface ParsedGame {
  baseFen: string;
  moves: { uci: string; san: string }[];
  headers: Map<string, string>;
}

/** Headers-only PGN describing a setup position (for the editor's PGN box). */
export function makePositionPgn(fen: string): string {
  const headers = defaultHeaders();
  if (fen.trim() !== START_FEN) {
    headers.set('SetUp', '1');
    headers.set('FEN', fen.trim());
  }
  const game: Game<PgnNodeData> = { headers, moves: { children: [] } };
  return makePgn(game);
}

/** Cheap sniff so the Home box can route paste text to PGN-import vs FEN. */
export function looksLikePgn(text: string): boolean {
  const t = text.trim();
  if (/\[[A-Za-z0-9]+\s+"/.test(t)) return true;      // a [Tag "..."] header line
  if (/\b\d+\.\s*[A-Za-z]/.test(t)) return true;       // a "1. e4" style movetext token
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/pgn.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/core/pgn.ts src/tests/pgn.test.ts
git commit -m "feat(pgn): makePositionPgn + looksLikePgn (chessops/pgn wrapper)"
```

---

### Task 2: Wire the editor's live PGN box

**Files:**
- Modify: `src/App.svelte` (add reactive `editPgn`, pass to `EditPanel`)
- Test: `src/tests/editorPgn.test.ts`

- [ ] **Step 1: Write the failing test** (drives the box off the FEN the panel receives)

```ts
// src/tests/editorPgn.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import EditPanel from '../components/EditPanel.svelte';
import { makePositionPgn } from '../core/pgn';

describe('EditPanel PGN box', () => {
  it('shows the SetUp/FEN PGN for the given position', () => {
    const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    const { getByTestId } = render(EditPanel, { props: { fen, pgn: makePositionPgn(fen) } });
    const box = getByTestId('edit-pgn') as HTMLTextAreaElement;
    expect(box.value).toContain('[SetUp "1"]');
    expect(box.value).toContain(`[FEN "${fen}"]`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/editorPgn.test.ts`
Expected: FAIL — `box.value` is empty (App never passes `pgn`, and the default is `''`). The test passes `pgn` directly here, so it will actually PASS at the component level; the real wiring is in App. To make this a true red→green, first assert the App wiring: change the test to import `App` is heavy — instead keep this component test AND add the App reactive in Step 3, verified by `npm run check` + manual. Expected here: PASS (component already supports the prop).

> Note: `EditPanel` already declares `export let pgn` and binds it to the `data-testid="edit-pgn"` textarea, so no component change is needed. This task's real change is in `App.svelte`.

- [ ] **Step 3: Add the reactive wiring in `App.svelte`**

In the `<script>`, add the import and reactive value:

```ts
import { makePositionPgn } from './core/pgn';
```

Add near the other `$:` reactives (after `editFen` is declared/used):

```ts
$: editPgn = makePositionPgn(editFen);
```

Pass it into the editor (add `pgn={editPgn}` to the existing `<EditPanel ... />`):

```svelte
<EditPanel fen={editFen} side={editSide} castle={editCastle} selected={selectedEditPiece}
  pgn={editPgn}
  editError={editError}
  onSelect={onSelectPiece} onSide={onEditSide} onToggleCastle={onToggleCastle}
  onFlip={onFlip} onReset={onEditReset} onClear={onEditClear}
  onFenInput={onEditFenInput} onLoad={onEditLoad} onBack={onEditBack} />
```

Because `rebuildEditFen()` already reassigns `editFen` on every piece drop (`onBoardEdit`), side change, castling toggle, reset, and clear, `editPgn` recomputes and the readonly box updates live.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/tests/editorPgn.test.ts && npm run check`
Expected: test PASS; `check` reports 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte src/tests/editorPgn.test.ts
git commit -m "feat(editor): live PGN box reflecting the setup position"
```

---

### Task 3: `core/pgn.ts` — `parseGame`

**Files:**
- Modify: `src/core/pgn.ts` (add `parseGame`)
- Test: `src/tests/pgn.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// append to src/tests/pgn.test.ts
import { parseGame } from '../core/pgn';

describe('parseGame', () => {
  it('parses mainline SAN into UCI from the standard start', () => {
    const g = parseGame('[Event "x"]\n\n1. e4 e5 2. Nf3 Nc6 *');
    expect(g.baseFen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    expect(g.moves.map((m) => m.uci)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('honours a [FEN]/[SetUp] starting position', () => {
    const pgn = '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. Rh8+ *';
    const g = parseGame(pgn);
    expect(g.baseFen.startsWith('4k3/8/8/8/8/8/8/4K2R w K')).toBe(true);
    expect(g.moves[0].uci).toBe('h1h8');
  });

  it('takes the first game of a multi-game file', () => {
    const g = parseGame('1. d4 d5 *\n\n1. c4 c5 *');
    expect(g.moves[0].uci).toBe('d2d4');
  });

  it('throws on illegal SAN', () => {
    expect(() => parseGame('1. e5 *')).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/pgn.test.ts`
Expected: FAIL — "parseGame is not a function".

- [ ] **Step 3: Add the implementation to `core/pgn.ts`**

Add imports and the function:

```ts
// add to the import from 'chessops/pgn':  (already importing parsePgn, startingPosition)
// add:
import type { Position } from 'chessops/chess';

export function parseGame(text: string): ParsedGame {
  const games = parsePgn(text);
  if (games.length === 0) throw new Error('no game found in PGN');
  const game = games[0];

  const posResult = startingPosition(game.headers);
  if (posResult.isErr) throw new Error(`invalid start position: ${posResult.error.message}`);
  const pos: Position = posResult.unwrap();
  if (pos.rules !== 'chess') throw new Error(`unsupported variant: ${pos.rules}`);
  const baseFen = makeFen(pos.toSetup());

  const moves: { uci: string; san: string }[] = [];
  let node = game.moves.children[0]; // mainline = first child chain
  let moveNo = 0;
  while (node) {
    moveNo += 1;
    const move = parseSan(pos, node.data.san);
    if (!move) throw new Error(`illegal or ambiguous SAN "${node.data.san}" at move ${moveNo}`);
    moves.push({ uci: makeUci(move), san: node.data.san });
    pos.play(move);
    node = node.children[0];
  }

  return { baseFen, moves, headers: game.headers };
}
```

> `startingPosition` lives in `chessops/variant` but is re-exported from `chessops/pgn`; keep it in the existing `chessops/pgn` import. `Position` is the base type of `Chess`; `pos.play(move)` mutates the running position, which is what we want here.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/pgn.test.ts`
Expected: PASS (all pgn tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/pgn.ts src/tests/pgn.test.ts
git commit -m "feat(pgn): parseGame — PGN mainline -> base FEN + UCI moves"
```

---

### Task 4: `load_pgn` command → orchestrator history + Home routing

**Files:**
- Modify: `src/lib/types.ts` (add the `load_pgn` command)
- Modify: `src/core/orchestrator.ts` (`loadPgn`, dispatch case)
- Modify: `src/App.svelte` (`onStart` routes PGN vs FEN)
- Test: `src/tests/orchestratorReport.test.ts` (new; starts with load_pgn coverage)

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/orchestratorReport.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../core/orchestrator';
import type { ServerFrame, StateFrame } from '../lib/types';

function makeOrch() {
  const frames: ServerFrame[] = [];
  const engine = { select: vi.fn(), setOption: vi.fn() };
  // A session stub that never calls back (analysis stays "started" but silent).
  const session = { start: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
  const orch = new Orchestrator((f) => frames.push(f), {
    engine,
    sessionFactory: () => session,
    analysisEnabled: false,
  });
  const last = () => frames.filter((f): f is StateFrame => f.type === 'state').at(-1)!;
  return { orch, frames, last, session };
}

describe('load_pgn', () => {
  it('loads a PGN into the linear history', () => {
    const { orch, last } = makeOrch();
    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' });
    const s = last();
    expect(s.moveList.map((m) => m.uci)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(s.currentPly).toBe(4);
  });

  it('emits an error frame on invalid PGN and leaves history empty', () => {
    const { orch, frames } = makeOrch();
    orch.handle({ type: 'load_pgn', pgn: '1. e5 *' });
    expect(frames.some((f) => f.type === 'error')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/orchestratorReport.test.ts`
Expected: FAIL — dispatch hits `default` → error "unknown command: load_pgn" (so the first assertion fails).

- [ ] **Step 3a: Add the command to `lib/types.ts`**

In the `Command` union add:

```ts
  | { type: 'load_pgn'; pgn: string }
```

- [ ] **Step 3b: Implement `loadPgn` in `core/orchestrator.ts`**

Add the import at the top:

```ts
import { parseGame } from './pgn';
```

Add a dispatch case inside the `try` switch in `handle()` (next to `set_fen`):

```ts
        case 'load_pgn': this.loadPgn(cmd.pgn); break;
```

Add the method (near `setFen`):

```ts
  loadPgn(pgn: string): void {
    let parsed: { baseFen: string; moves: { uci: string; san: string }[] };
    try {
      parsed = parseGame(pgn);
    } catch (exc) {
      this._error(`invalid PGN: ${exc instanceof Error ? exc.message : String(exc)}`);
      return;
    }
    let board: Chess;
    try {
      board = posFromFen(parsed.baseFen);
    } catch (exc) {
      this._error(`invalid PGN start position: ${exc instanceof Error ? exc.message : String(exc)}`);
      return;
    }
    this._session.stop();
    this._baseFen = fenOf(board);
    // Rebuild the explicit history by replaying the mainline (mirrors _playMove's SAN step).
    this._history = [];
    let running = board;
    for (const m of parsed.moves) {
      const san = sanOf(running, m.uci);
      this._history.push({ move: m.uci, san });
      running = playUci(running, m.uci);
    }
    this._cursor = this._history.length;
    this._board = running;
    this._resetMoveState();
    this._restart();
  }
```

- [ ] **Step 3c: Route the Home box in `App.svelte`**

Replace `onStart` with PGN detection:

```ts
import { looksLikePgn } from './core/pgn';
// ...
function onStart(text: string): void {
  const trimmed = text.trim();
  if (trimmed) {
    if (looksLikePgn(trimmed)) send({ type: 'load_pgn', pgn: trimmed });
    else send({ type: 'set_fen', fen: trimmed });
  }
  enterAnalysis();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/orchestratorReport.test.ts && npm run check`
Expected: PASS; `check` 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/core/orchestrator.ts src/App.svelte src/tests/orchestratorReport.test.ts
git commit -m "feat(pgn): load_pgn command loads a game into history; Home routes PGN vs FEN"
```

---

## Phase B — Accuracy core (`core/accuracy.ts`, pure)

### Task 5: Win% primitives — `cpFromEval`, `winningChances`, `winPercent`

**Files:**
- Create: `src/core/accuracy.ts`
- Test: `src/tests/accuracy.test.ts`

- [ ] **Step 1: Write the failing test** (exact Lichess reference values)

```ts
// src/tests/accuracy.test.ts
import { describe, it, expect } from 'vitest';
import { cpFromEval, winningChances, winPercent } from '../core/accuracy';

describe('winPercent / winningChances', () => {
  it('is 50 at cp 0', () => {
    expect(winPercent(0)).toBeCloseTo(50, 6);
    expect(winningChances(0)).toBeCloseTo(0, 6);
  });
  it('clamps cp to ±1000 → ~97.4 / ~2.6', () => {
    expect(winPercent(1000)).toBeCloseTo(97.4485, 2);
    expect(winPercent(-1000)).toBeCloseTo(2.5515, 2);
    expect(winPercent(5000)).toBeCloseTo(winPercent(1000), 6); // ceiled
  });
});

describe('cpFromEval', () => {
  it('maps mate to the signed ±1000 ceiling (White POV)', () => {
    expect(cpFromEval({ cp: null, mate: 3 })).toBe(1000);
    expect(cpFromEval({ cp: null, mate: -2 })).toBe(-1000);
  });
  it('clamps a big cp to ±1000 and passes through small cp', () => {
    expect(cpFromEval({ cp: 4200, mate: null })).toBe(1000);
    expect(cpFromEval({ cp: -35, mate: null })).toBe(-35);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/accuracy.test.ts`
Expected: FAIL — "Failed to resolve import '../core/accuracy'".

- [ ] **Step 3: Write the implementation**

```ts
// src/core/accuracy.ts
/**
 * core/accuracy.ts — pure Lichess-parity analysis math.
 * Constants verified against scalachess (eval.scala), lila
 * (AccuracyPercent.scala, AccuracyCP.scala) and scalalib (Maths.scala).
 * No chessops import.
 */
import type { Eval } from '../engine/types';

const CP_CEILING = 1000;                 // scalachess Eval.Cp.CEILING
const WIN_MULTIPLIER = -0.00368208;      // scalachess winningChances (lila #11148)

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** White-POV centipawns, clamped to ±1000; mate → signed ceiling. */
export function cpFromEval(e: Eval): number {
  if (e.mate !== null) return e.mate > 0 ? CP_CEILING : -CP_CEILING;
  return clamp(e.cp ?? 0, -CP_CEILING, CP_CEILING);
}

/** Winning chances in [-1, +1]. NOTE: the classifier uses this scale. */
export function winningChances(cp: number): number {
  return clamp(2 / (1 + Math.exp(WIN_MULTIPLIER * cp)) - 1, -1, 1);
}

/** Win% in [0, 100]; cp pre-ceiled to ±1000. */
export function winPercent(cp: number): number {
  return 50 + 50 * winningChances(clamp(cp, -CP_CEILING, CP_CEILING));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/accuracy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/accuracy.ts src/tests/accuracy.test.ts
git commit -m "feat(accuracy): Win% primitives (cpFromEval, winningChances, winPercent)"
```

---

### Task 6: Per-move accuracy + Maths helpers

**Files:**
- Modify: `src/core/accuracy.ts`
- Test: `src/tests/accuracy.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// append to src/tests/accuracy.test.ts
import { moveAccuracy, weightedMean, harmonicMean, populationStdDev } from '../core/accuracy';

describe('moveAccuracy', () => {
  it('is 100 when win% does not drop', () => {
    expect(moveAccuracy(60, 65)).toBe(100);
    expect(moveAccuracy(60, 60)).toBe(100);
  });
  it('applies the Lichess fit (+1 bonus), clamped [0,100]', () => {
    // winDiff = 20 → 103.16681*exp(-0.04354415*20) - 3.16692 + 1 ≈ 41.06
    expect(moveAccuracy(70, 50)).toBeCloseTo(41.06, 1);
    expect(moveAccuracy(100, 0)).toBeGreaterThanOrEqual(0);
    expect(moveAccuracy(100, 0)).toBeLessThanOrEqual(100);
  });
});

describe('Maths helpers', () => {
  it('weightedMean', () => {
    expect(weightedMean([[10, 1], [20, 3]])).toBeCloseTo(17.5, 6);
    expect(weightedMean([])).toBeNull();
  });
  it('harmonicMean guards each term with max(1, v)', () => {
    expect(harmonicMean([2, 2, 2])).toBeCloseTo(2, 6);
    expect(harmonicMean([])).toBeNull();
  });
  it('populationStdDev divides by n', () => {
    expect(populationStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/accuracy.test.ts`
Expected: FAIL — "moveAccuracy is not a function".

- [ ] **Step 3: Add the implementation to `core/accuracy.ts`**

```ts
// AccuracyPercent.fromWinPercents (lila) — before/after are mover-POV win% (0..100).
export function moveAccuracy(beforeWin: number, afterWin: number): number {
  if (afterWin >= beforeWin) return 100;
  const winDiff = beforeWin - afterWin;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) - 3.166924740191411;
  return clamp(raw + 1, 0, 100); // +1 uncertainty bonus
}

// scalalib Maths.weightedMean — Σ(v*w)/Σ(w); null if Σw == 0.
export function weightedMean(pairs: [number, number][]): number | null {
  let sv = 0, sw = 0;
  for (const [v, w] of pairs) { sv += v * w; sw += w; }
  return sw === 0 ? null : sv / sw;
}

// scalalib Maths.harmonicMean — n / Σ(1/max(1,v)); null if empty.
export function harmonicMean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const v of xs) s += 1 / Math.max(1, v);
  return xs.length / s;
}

// scalalib Maths.standardDeviation — population (÷ n).
export function populationStdDev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
  return Math.sqrt(variance);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/accuracy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/accuracy.ts src/tests/accuracy.test.ts
git commit -m "feat(accuracy): per-move accuracy + weighted/harmonic mean + population stddev"
```

---

### Task 7: Game accuracy + ACPL

**Files:**
- Modify: `src/core/accuracy.ts`
- Test: `src/tests/accuracy.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// append to src/tests/accuracy.test.ts
import { gameAccuracy, acpl } from '../core/accuracy';

describe('gameAccuracy', () => {
  it('gives near-100 for a dead-level game and lower for the side that drops chances', () => {
    // 6 half-moves, White plays a big blunder on move 3 (its 2nd move): 40 -> -300 cp.
    // cpsAfterMoves are WHITE-POV cp for positions after each move.
    const cps = [30, 20, 35, 25, -300, 10];
    const { white, black } = gameAccuracy(true, cps);
    expect(white).toBeGreaterThan(0);
    expect(white).toBeLessThan(100);
    expect(black).toBeGreaterThan(white); // White threw chances away, Black didn't
  });
  it('is symmetric-ish for a perfectly level game', () => {
    const cps = [15, 15, 15, 15];
    const { white, black } = gameAccuracy(true, cps);
    expect(white).toBeCloseTo(100, 0);
    expect(black).toBeCloseTo(100, 0);
  });
});

describe('acpl', () => {
  it('averages each colour’s per-move centipawn loss (mover POV, capped)', () => {
    // positions 0..4 (start + 4 moves), White POV cp. White moves = 1,3; Black = 2,4.
    const cps = [20, 10, 40, 30, -260];
    // white losses: move1 (20->10)=10 ; move3 (40->30)=10 → mean 10
    // black losses: move2 (10->40)= -30→0 ; move4 (30->-260) mover=black so drop = -( -260-30 )=290 → mean 145
    expect(acpl(cps, true, 'white')).toBe(10);
    expect(acpl(cps, true, 'black')).toBe(145);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/accuracy.test.ts`
Expected: FAIL — "gameAccuracy is not a function".

- [ ] **Step 3: Add the implementation to `core/accuracy.ts`**

```ts
const CP_INITIAL = 15; // scalachess Eval.Cp.initial — seeded as position 0 in game accuracy

/**
 * AccuracyPercent.gameAccuracy — per-colour game accuracy.
 * @param startWhite  true if White moves first at the base position
 * @param cpsAfterMoves  White-POV cp for the position AFTER each move (length = #moves)
 */
export function gameAccuracy(startWhite: boolean, cpsAfterMoves: (number | null)[]): { white: number; black: number } {
  const allWin: (number | null)[] = [winPercent(CP_INITIAL), ...cpsAfterMoves.map((c) => (c === null ? null : winPercent(c)))];
  const n = cpsAfterMoves.length;
  if (n === 0) return { white: 100, black: 100 };

  const windowSize = clamp(Math.floor(n / 10), 2, 8);
  // (windowSize - 2) leading copies of the first window, then every sliding window.
  const windows: (number | null)[][] = [];
  const firstWindow = allWin.slice(0, Math.min(windowSize, allWin.length));
  for (let i = 0; i < Math.max(0, Math.min(windowSize, allWin.length) - 2); i++) windows.push(firstWindow);
  for (let i = 0; i + windowSize <= allWin.length; i++) windows.push(allWin.slice(i, i + windowSize));

  const weightAt = (i: number): number => {
    const w = windows[Math.min(i, windows.length - 1)] ?? firstWindow;
    const vals = w.filter((x): x is number => x !== null);
    return clamp(populationStdDev(vals), 0.5, 12);
  };

  // Per-move accuracy from sliding pairs; colour = mover of move (i+1).
  const per: { acc: number; weight: number; white: boolean }[] = [];
  for (let i = 1; i < allWin.length; i++) {
    const before = allWin[i - 1], after = allWin[i];
    if (before === null || after === null) continue;
    const moverWhite = startWhite ? (i % 2 === 1) : (i % 2 === 0);
    // mover-POV win%: White uses win% directly, Black uses 100 - win%.
    const b = moverWhite ? before : 100 - before;
    const a = moverWhite ? after : 100 - after;
    per.push({ acc: moveAccuracy(b, a), weight: weightAt(i - 1), white: moverWhite });
  }

  const forColour = (white: boolean): number => {
    const rows = per.filter((p) => p.white === white);
    if (rows.length === 0) return 100;
    const weighted = weightedMean(rows.map((r) => [r.acc, r.weight] as [number, number]));
    const harmonic = harmonicMean(rows.map((r) => r.acc));
    if (weighted === null || harmonic === null) return 100;
    return clamp((weighted + harmonic) / 2, 0, 100);
  };

  return { white: forColour(true), black: forColour(false) };
}

/**
 * AccuracyCP.mean — average centipawn loss for one colour.
 * @param cpsPositions  White-POV cp for positions 0..N (start + after each move)
 */
export function acpl(cpsPositions: number[], startWhite: boolean, color: 'white' | 'black'): number {
  const losses: number[] = [];
  for (let k = 1; k < cpsPositions.length; k++) {
    const moverWhite = startWhite ? (k % 2 === 1) : (k % 2 === 0);
    if (moverWhite !== (color === 'white')) continue;
    const drop = (cpsPositions[k - 1] - cpsPositions[k]) * (moverWhite ? 1 : -1);
    losses.push(Math.max(0, drop));
  }
  if (losses.length === 0) return 0;
  return Math.round(losses.reduce((a, b) => a + b, 0) / losses.length);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/accuracy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/accuracy.ts src/tests/accuracy.test.ts
git commit -m "feat(accuracy): game accuracy (windowed weighted+harmonic) and ACPL"
```

---

## Phase C — Classification reconciliation

### Task 8: Swap ?!/?/?? to Lichess winning-chances drop (+ mate branch)

**Files:**
- Modify: `src/core/classify.ts`
- Test: `src/tests/classify.test.ts` (rewrite the ?!/?/?? band assertions)

- [ ] **Step 1: Write the failing test** (new file focused on the reconciled bands; keep it separate so the large existing `classify.test.ts` parity file can be updated in the same task)

```ts
// src/tests/reportClassify.test.ts
import { describe, it, expect } from 'vitest';
import { classifyMove, MoveClass } from '../core/classify';
import { posFromFen } from '../core/chess';
import type { AnalysisInfo } from '../engine/types';

// Helper: single-line analysis with a given White-POV cp and a chosen best move.
function info(fen: string, cp: number, bestPv: string[]): AnalysisInfo {
  return { fen, depth: 20, lines: [{ multipv: 1, eval: { cp, mate: null }, depth: 20, pv: bestPv }] };
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('winning-chances classification bands (White to move)', () => {
  const pos = posFromFen(START);
  // White to move. before best = e2e4 at +40cp. The played move is g1f3 (not best),
  // and we vary the AFTER eval to move winning-chances by the Lichess thresholds.
  const before = info(START, 40, ['e2e4']);

  it('flags a blunder at a ≥0.30 winning-chances drop', () => {
    // winningChances(40)≈0.147 ; need after winningChances ≈ -0.16 → cp ≈ -44
    const after = info('after', -260, []); // large drop
    const c = classifyMove(pos, 'g1f3', before, after);
    expect(c.label).toBe(MoveClass.BLUNDER);
  });

  it('flags a mistake at a drop in [0.20,0.30)', () => {
    const after = info('after', -110, []);
    const c = classifyMove(pos, 'g1f3', before, after);
    expect(c.label).toBe(MoveClass.MISTAKE);
  });

  it('flags an inaccuracy at a drop in [0.10,0.20)', () => {
    const after = info('after', -35, []);
    const c = classifyMove(pos, 'g1f3', before, after);
    expect(c.label).toBe(MoveClass.INACCURACY);
  });

  it('a small drop (<0.10) is good/excellent, not an inaccuracy', () => {
    const after = info('after', 30, []);
    const c = classifyMove(pos, 'g1f3', before, after);
    expect([MoveClass.EXCELLENT, MoveClass.GOOD]).toContain(c.label);
  });
});
```

> Recompute the exact cp values from `winningChances` when implementing if the
> band boundaries land differently for your constants; the assertions above use
> comfortably-inside-the-band values.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/reportClassify.test.ts`
Expected: FAIL — current cpl-band logic classifies these by centipawn loss, not winning-chances, so at least one band assertion mismatches.

- [ ] **Step 3: Modify `core/classify.ts`**

Add the import:

```ts
import { cpFromEval, winningChances } from './accuracy';
```

Replace the "6. Centipawn-loss bands" block (the final `if (cpl <= ...)` ladder) with the Lichess winning-chances decision. Compute, just after `playedMover`/`cpl` are known:

```ts
  // ── Lichess ?!/?/?? via winning-chances drop (mover POV) ──────────────────
  const moverSign = moverWhite ? 1 : -1;
  const beforeEval = bestLineBefore.eval;   // position before, best play
  const afterEval = afterBest.eval;         // position after the played move
  const prevWC = winningChances(cpFromEval(beforeEval) * moverSign);
  const curWC = winningChances(cpFromEval(afterEval) * moverSign);
  const delta = prevWC - curWC;             // >0 = mover lost winning chances

  const mateInvolved = beforeEval.mate !== null || afterEval.mate !== null;
  if (mateInvolved) {
    // Lichess MateAdvice (mover-POV cp).
    const prevCp = cpFromEval(beforeEval) * moverSign;
    const curCp = cpFromEval(afterEval) * moverSign;
    const mateCreated = afterEval.mate !== null && (afterEval.mate * moverSign) < 0; // now getting mated
    const mateLost = beforeEval.mate !== null && (beforeEval.mate * moverSign) > 0 && afterEval.mate === null; // had mate, gone
    if (mateCreated) {
      if (prevCp < -999) return { label: MoveClass.INACCURACY, cpl, isBest };
      if (prevCp < -700) return { label: MoveClass.MISTAKE, cpl, isBest };
      return { label: MoveClass.BLUNDER, cpl, isBest };
    }
    if (mateLost) {
      if (curCp > 999) return { label: MoveClass.INACCURACY, cpl, isBest };
      if (curCp > 700) return { label: MoveClass.MISTAKE, cpl, isBest };
      return { label: MoveClass.BLUNDER, cpl, isBest };
    }
    // mate delayed / mate improved / both-mate — no negative judgement; fall to bands.
  } else {
    if (delta >= 0.30) return { label: MoveClass.BLUNDER, cpl, isBest };
    if (delta >= 0.20) return { label: MoveClass.MISTAKE, cpl, isBest };
    if (delta >= 0.10) return { label: MoveClass.INACCURACY, cpl, isBest };
  }

  // Not a negative judgement: rank by centipawn loss (Excellent/Good only).
  if (cpl <= t.excellentMax) return { label: MoveClass.EXCELLENT, cpl, isBest };
  return { label: MoveClass.GOOD, cpl, isBest };
```

Keep rules 1–5 (Book, Brilliant, Great, Best, Miss) exactly as they are, above this block. Update the file's top doc-comment to note the deliberate divergence from the Python parity for ?!/?/??.

- [ ] **Step 4: Run the new test; then fix the legacy parity test**

Run: `npx vitest run src/tests/reportClassify.test.ts`
Expected: PASS.

Now run the legacy file and update ONLY the assertions that asserted the old cpl-band ?!/?/?? outcomes:

Run: `npx vitest run src/tests/classify.test.ts`
Expected: some FAILs on inaccuracy/mistake/blunder cases. For each failing case, recompute the expected label from the winning-chances drop of that test's before/after evals and update the assertion. Do NOT touch Brilliant/Great/Best/Miss/Book/Excellent/Good assertions. Re-run until green.

- [ ] **Step 5: Commit**

```bash
git add src/core/classify.ts src/tests/reportClassify.test.ts src/tests/classify.test.ts
git commit -m "feat(classify): Lichess winning-chances ?!/?/?? bands + mate advice (rich set kept)"
```

---

## Phase D — Wire types + batch driver

### Task 9: Report DTOs, commands, frames, and store

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/engineClient.ts`
- Test: `src/tests/orchestratorReport.test.ts` (extend later; this task is type-only + store)

- [ ] **Step 1: Add DTOs, commands, and the frame to `lib/types.ts`**

```ts
// ── report DTOs ──
export interface PlyReportDto {
  ply: number;            // 1..N
  san: string; uci: string;
  winWhite: number;       // 0..100, White POV (for the graph)
  cpl: number;            // mover POV, capped
  classification: ClassificationDto | null;
}
export interface PlayerReportDto { accuracy: number; acpl: number; inaccuracy: number; mistake: number; blunder: number; }
export interface GameReportDto {
  white: PlayerReportDto; black: PlayerReportDto;
  startWin: number;       // White-POV win% at the base position (graph point 0)
  plies: PlyReportDto[];
}
export interface ReportFrame { type: 'report'; report: GameReportDto }
```

Add `reportProgress` to `StateFrame` (after `movetime`):

```ts
  reportProgress: { done: number; total: number } | null;
```

Extend `ServerFrame`:

```ts
export type ServerFrame = StateFrame | ErrorFrame | RegionShotFrame | ReportFrame;
```

Extend `Command` with the two new report commands:

```ts
  | { type: 'analyze_game' }
  | { type: 'cancel_analysis' }
```

- [ ] **Step 2: Add the stores + routing to `lib/engineClient.ts`**

Add the imports (extend the existing type import):

```ts
import type { Command, ServerFrame, StateFrame, RegionShotFrame, ReportFrame, GameReportDto } from './types';
```

Add stores near the others:

```ts
export const report = writable<GameReportDto | null>(null);
export const reportProgress = writable<{ done: number; total: number } | null>(null);
```

Extend `applyFrame` to route the report frame and mirror progress:

```ts
export function applyFrame(frame: ServerFrame): void {
  if (frame.type === 'state') { state.set(frame); reportProgress.set(frame.reportProgress); }
  else if (frame.type === 'report') report.set((frame as ReportFrame).report);
  else if (frame.type === 'region_shot') regionShot.set(frame);
  else if (frame.type === 'error') { lastError.set(frame.message); errorSeq.update((n) => n + 1); }
}
```

- [ ] **Step 3: Make `_stateFrame` emit `reportProgress`**

In `core/orchestrator.ts`, add a field and include it in `_stateFrame()`:

```ts
  _reportProgress: { done: number; total: number } | null = null;
```

In the object returned by `_stateFrame`, add:

```ts
      reportProgress: this._reportProgress,
```

- [ ] **Step 4: Verify types compile**

Run: `npm run check`
Expected: 0 errors. (Existing `_stateFrame` callers and tests that build `StateFrame`s may need `reportProgress: null` — fix any that fail typecheck by adding `reportProgress: null`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/engineClient.ts src/core/orchestrator.ts
git commit -m "feat(report): report DTOs, ReportFrame, reportProgress state + stores"
```

---

### Task 10: Batch analysis driver + report computation

**Files:**
- Modify: `src/core/orchestrator.ts`
- Test: `src/tests/orchestratorReport.test.ts` (extend)

- [ ] **Step 1: Write the failing test** (FakeSession scripts one eval per position)

```ts
// append to src/tests/orchestratorReport.test.ts
import type { AnalysisInfo } from '../engine/types';
import type { SessionCallbacks } from '../engine/session';

// A session that, on start(fen), immediately returns a scripted eval for that fen.
function scriptedFactory(evalForFen: (fen: string) => AnalysisInfo) {
  return (_engine: unknown, cb: SessionCallbacks) => ({
    start(fen: string) {
      queueMicrotask(() => { cb.onUpdate(evalForFen(fen)); cb.onDone?.(); });
    },
    stop() {}, dispose() {},
  });
}

describe('analyze_game', () => {
  it('produces a report with per-player accuracy, counts, and per-ply data', async () => {
    const frames: ServerFrame[] = [];
    const engine = { select: vi.fn(), setOption: vi.fn() };
    // White-POV cp: level until Black blunders on ply 4 (…Nf6 lets White be winning).
    const cpByPlacement = (fen: string): number => {
      const placement = fen.split(' ')[0];
      if (placement.includes('QP')) return 900;      // arbitrary "White winning" position
      return 20;
    };
    const orch = new Orchestrator((f) => frames.push(f), {
      engine,
      sessionFactory: scriptedFactory((fen) => ({ fen, depth: 20, lines: [{ multipv: 1, eval: { cp: cpByPlacement(fen), mate: null }, depth: 20, pv: ['a2a3'] }] })),
      analysisEnabled: false,
    });

    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' });
    orch.handle({ type: 'analyze_game' });
    // Let the queued microtasks drain (one per position).
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const rep = frames.find((f) => f.type === 'report');
    expect(rep).toBeDefined();
    if (rep && rep.type === 'report') {
      expect(rep.report.plies).toHaveLength(4);
      expect(rep.report.white.accuracy).toBeGreaterThan(0);
      expect(rep.report.plies[0].winWhite).toBeGreaterThan(0);
    }
  });

  it('errors when there is no game to analyze', () => {
    const { orch, frames } = makeOrch();
    orch.handle({ type: 'analyze_game' });
    expect(frames.some((f) => f.type === 'error')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/orchestratorReport.test.ts`
Expected: FAIL — dispatch → "unknown command: analyze_game".

- [ ] **Step 3: Implement the batch driver in `core/orchestrator.ts`**

Add imports:

```ts
import { cpFromEval, winPercent, gameAccuracy, acpl } from './accuracy';
import { MoveClass } from './classify';
import type { GameReportDto, PlyReportDto } from '../lib/types';
import { getOverrides } from '../lib/engineOptions';
```

Add fields:

```ts
  _reportDepth = 18;
  private _batch: { fens: string[]; i: number; evals: (AnalysisInfo | null)[]; latest: AnalysisInfo | null; priorMpv: string | null } | null = null;
```

Add dispatch cases in the `try` switch:

```ts
        case 'analyze_game': this.analyzeGame(); break;
        case 'cancel_analysis': this.cancelAnalysis(); break;
```

Add the methods:

```ts
  analyzeGame(): void {
    if (this._history.length === 0) { this._error('no game to analyze'); return; }
    this._session.stop();
    // Precompute the position FEN at each ply (0 = base, k = after move k).
    const fens: string[] = [this._baseFen];
    let pos = posFromFen(this._baseFen);
    for (const e of this._history) { pos = playUci(pos, e.move); fens.push(fenOf(pos)); }
    const priorMpv = getOverrides(this._engineId)['MultiPV'] ?? null;
    // Best-effort: 2 lines so "Great" (only-move) can still fire. No-op if engine not yet loaded.
    this._engine.setOption?.('MultiPV', '2');
    this._batch = { fens, i: 0, evals: new Array(fens.length).fill(null), latest: null, priorMpv };
    this._reportProgress = { done: 0, total: fens.length };
    this._analyzing = true;
    this._send(this._stateFrame(this._lastAnalysis));
    this._batchStepStart();
  }

  cancelAnalysis(): void {
    if (this._batch === null) return;
    this._session.stop();
    this._engine.setOption?.('MultiPV', this._batch.priorMpv ?? '1');
    this._batch = null;
    this._reportProgress = null;
    this._analyzing = false;
    this._send(this._stateFrame(this._lastAnalysis));
  }

  private _batchStepStart(): void {
    const b = this._batch;
    if (b === null) return;
    if (b.i >= b.fens.length) { this._batchFinish(); return; }
    const fen = b.fens[b.i];
    const board = posFromFen(fen);
    const oc = outcomeOf(board);
    if (oc !== null) {
      // Terminal position: synthesize the eval instead of asking the engine.
      let evalDto: Eval;
      if (oc.result === '1-0') evalDto = { cp: null, mate: 1 };
      else if (oc.result === '0-1') evalDto = { cp: null, mate: -1 };
      else evalDto = { cp: 0, mate: null };
      b.evals[b.i] = { fen, depth: this._reportDepth, lines: [{ multipv: 1, eval: evalDto, depth: this._reportDepth, pv: [] }] };
      b.latest = null;
      this._batchAdvance();
      return;
    }
    b.latest = null;
    this._session.start(fen, { depth: this._reportDepth, timeMs: null });
  }

  private _batchAdvance(): void {
    const b = this._batch;
    if (b === null) return;
    b.i += 1;
    this._reportProgress = { done: b.i, total: b.fens.length };
    this._send(this._stateFrame(this._lastAnalysis));
    this._batchStepStart();
  }

  private _batchFinish(): void {
    const b = this._batch;
    if (b === null) return;
    this._engine.setOption?.('MultiPV', b.priorMpv ?? '1');
    const report = this._buildReport(b.evals);
    this._batch = null;
    this._reportProgress = null;
    this._analyzing = false;
    this._send({ type: 'report', report });
    this._send(this._stateFrame(this._lastAnalysis));
  }
```

Route the batch inside the existing callbacks. At the TOP of `_onUpdate`:

```ts
  _onUpdate = (info: AnalysisInfo): void => {
    if (this._batch !== null) { this._batch.latest = info; return; }
    // ... existing live-analysis body unchanged ...
```

At the TOP of `_onSearchDone`:

```ts
  _onSearchDone = (): void => {
    if (this._batch !== null) {
      this._batch.evals[this._batch.i] = this._batch.latest;
      this._batchAdvance();
      return;
    }
    // ... existing body unchanged ...
```

Add the report builder (uses the annotate-history side effect so navigation shows badges):

```ts
  private _buildReport(evals: (AnalysisInfo | null)[]): GameReportDto {
    const startWhite = posFromFen(this._baseFen).turn === 'white';
    const cpsPositions: number[] = evals.map((a) => (a && bestLine(a) ? cpFromEval(bestLine(a)!.eval) : 0));
    const cpsAfterMoves = cpsPositions.slice(1);
    const { white, black } = gameAccuracy(startWhite, cpsAfterMoves);

    const counts = { white: { i: 0, m: 0, b: 0 }, black: { i: 0, m: 0, b: 0 } };
    const plies: PlyReportDto[] = [];
    let board = posFromFen(this._baseFen);
    for (let k = 0; k < this._history.length; k++) {
      const before = evals[k], after = evals[k + 1];
      const entry = this._history[k];
      const moverWhite = board.turn === 'white';
      let classification = null;
      if (before && after && bestLine(before) && lineMove(bestLine(before)!) && bestLine(after)) {
        const c = classifyMove(board, entry.move, before, after);
        classification = c;
        entry.classification = c;
        entry.lastMove = lastMoveToDict(c, board, entry.move, before, after);
        entry.preAnalysis = before;
        const side = moverWhite ? counts.white : counts.black;
        if (c.label === MoveClass.INACCURACY) side.i++;
        else if (c.label === MoveClass.MISTAKE) side.m++;
        else if (c.label === MoveClass.BLUNDER) side.b++;
      }
      plies.push({
        ply: k + 1,
        san: entry.san,
        uci: entry.move,
        winWhite: after && bestLine(after) ? winPercent(cpFromEval(bestLine(after)!.eval)) : 50,
        cpl: classification?.cpl ?? 0,
        classification: classification ? classificationToDict(classification) : null,
      });
      board = playUci(board, entry.move);
    }

    return {
      white: { accuracy: Math.round(white), acpl: acpl(cpsPositions, startWhite, 'white'), inaccuracy: counts.white.i, mistake: counts.white.m, blunder: counts.white.b },
      black: { accuracy: Math.round(black), acpl: acpl(cpsPositions, startWhite, 'black'), inaccuracy: counts.black.i, mistake: counts.black.m, blunder: counts.black.b },
      startWin: winPercent(cpsPositions[0]),
      plies,
    };
  }
```

> `Eval`, `bestLine`, `lineMove`, `lastMoveToDict`, `classificationToDict`,
> `classifyMove` are already imported at the top of `orchestrator.ts`. If
> `lineMove` is not imported, add it to the `engine/types` import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/orchestratorReport.test.ts && npm run check`
Expected: PASS; `check` 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.ts src/tests/orchestratorReport.test.ts
git commit -m "feat(report): batch analysis driver + Lichess-parity report builder"
```

---

## Phase E — Report screen UI

### Task 11: `EvalGraph.svelte`

**Files:**
- Create: `src/components/EvalGraph.svelte`
- Test: `src/tests/EvalGraph.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/EvalGraph.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import EvalGraph from '../components/EvalGraph.svelte';

const wins = [51, 60, 48, 62, 20, 97];

describe('EvalGraph', () => {
  it('renders an SVG path and a marker', () => {
    const { container } = render(EvalGraph, { props: { wins, currentPly: 2 } });
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('[data-testid="eval-curve"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="eval-marker"]')).toBeTruthy();
  });

  it('calls onNavigate with the nearest ply on click', async () => {
    const onNavigate = vi.fn();
    const { container } = render(EvalGraph, { props: { wins, currentPly: 0, onNavigate } });
    const svg = container.querySelector('svg')!;
    // jsdom returns 0-size rects; provide a stub so the fraction math is deterministic.
    svg.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 96, right: 100, bottom: 96, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await fireEvent.click(svg, { clientX: 100 });
    expect(onNavigate).toHaveBeenCalledWith(wins.length - 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/EvalGraph.test.ts`
Expected: FAIL — cannot resolve `../components/EvalGraph.svelte`.

- [ ] **Step 3: Write the component**

```svelte
<!-- src/components/EvalGraph.svelte -->
<script lang="ts">
  export let wins: number[] = [];         // White-POV win% per position (index 0 = base)
  export let currentPly = 0;              // 0..wins.length-1
  export let onNavigate: (ply: number) => void = () => {};

  const W = 340, H = 96;
  $: n = wins.length;
  $: xAt = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  $: yAt = (w: number) => H * (1 - w / 100);
  $: curve = wins.map((w, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(w).toFixed(1)}`).join(' ');
  $: area = n ? `M0 ${H} L${curve.slice(1)} L${W} ${H} Z` : '';
  $: midY = yAt(50).toFixed(1);
  $: mx = xAt(currentPly).toFixed(1);
  $: my = yAt(wins[currentPly] ?? 50).toFixed(1);

  function onClick(e: MouseEvent): void {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    if (r.width === 0 || n <= 1) return;
    const frac = (e.clientX - r.left) / r.width;
    onNavigate(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  }
</script>

<svg class="eval-graph" viewBox="0 0 {W} {H}" preserveAspectRatio="none"
     role="img" aria-label="Evaluation graph" on:click={onClick}>
  <rect x="0" y="0" width={W} height={H} fill="var(--ink-2)" />
  {#if area}<path d={area} fill="var(--paper-2)" />{/if}
  <line x1="0" y1={midY} x2={W} y2={midY} stroke="var(--keyline-2)" stroke-width="1" stroke-dasharray="3 3" opacity="0.55" />
  {#if curve}<path data-testid="eval-curve" d={curve} fill="none" stroke="var(--green)" stroke-width="1.6" />{/if}
  <line data-testid="eval-marker" x1={mx} y1="0" x2={mx} y2={H} stroke="var(--amber)" stroke-width="1.4" />
  <circle cx={mx} cy={my} r="3.4" fill="var(--amber)" stroke="#fff" stroke-width="1.4" />
</svg>

<style>
  .eval-graph { width: 100%; height: 96px; display: block; border: 1px solid var(--keyline); border-radius: 6px; cursor: pointer; }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/EvalGraph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/EvalGraph.svelte src/tests/EvalGraph.test.ts
git commit -m "feat(report): EvalGraph — SVG win% area chart with clickable ply marker"
```

---

### Task 12: `AccuracyDial.svelte`

**Files:**
- Create: `src/components/AccuracyDial.svelte`
- Test: `src/tests/AccuracyDial.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/AccuracyDial.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AccuracyDial from '../components/AccuracyDial.svelte';

describe('AccuracyDial', () => {
  it('renders the percentage and a progress ring', () => {
    const { container, getByText } = render(AccuracyDial, { props: { percent: 86, label: 'White' } });
    expect(getByText('86')).toBeTruthy();
    const rings = container.querySelectorAll('circle');
    expect(rings.length).toBeGreaterThanOrEqual(2); // track + progress
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/AccuracyDial.test.ts`
Expected: FAIL — cannot resolve component.

- [ ] **Step 3: Write the component**

```svelte
<!-- src/components/AccuracyDial.svelte -->
<script lang="ts">
  export let percent = 0;      // 0..100
  export let label = '';
  export let side: 'white' | 'black' | null = null;

  const R = 38, CX = 48, CY = 48;
  const C = 2 * Math.PI * R;
  $: off = C * (1 - Math.max(0, Math.min(100, percent)) / 100);
  // Colour band: high = green, mid = amber, low = red (matches move-class palette).
  $: color = percent >= 80 ? 'var(--best)' : percent >= 60 ? 'var(--inacc)' : 'var(--mist)';
</script>

<div class="dial">
  <svg width="96" height="96" viewBox="0 0 96 96">
    <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--keyline)" stroke-width="8" />
    <circle cx={CX} cy={CY} r={R} fill="none" stroke={color} stroke-width="8" stroke-linecap="round"
            stroke-dasharray={C} stroke-dashoffset={off} transform="rotate(-90 {CX} {CY})" />
    <text class="num" x="48" y="50" text-anchor="middle" dominant-baseline="middle">{Math.round(percent)}<tspan font-size="12" dy="-8">%</tspan></text>
  </svg>
  <span class="who">
    {#if side}<span class="dot {side}"></span>{/if}{label}
  </span>
</div>

<style>
  .dial { display: flex; flex-direction: column; align-items: center; gap: 7px; }
  .num { font-family: var(--serif); font-weight: 600; font-size: 23px; fill: var(--ink); }
  .who { font-family: var(--mono); font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); display: flex; align-items: center; gap: 6px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; border: 1px solid var(--keyline-2); display: inline-block; }
  .dot.white { background: #f7f3ea; } .dot.black { background: #2b2823; }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/AccuracyDial.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AccuracyDial.svelte src/tests/AccuracyDial.test.ts
git commit -m "feat(report): AccuracyDial — SVG accuracy ring"
```

---

### Task 13: `ReportPanel.svelte`

**Files:**
- Create: `src/components/ReportPanel.svelte`
- Test: `src/tests/ReportPanel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/ReportPanel.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ReportPanel from '../components/ReportPanel.svelte';
import type { GameReportDto, MoveEntryDto } from '../lib/types';

const report: GameReportDto = {
  white: { accuracy: 92, acpl: 19, inaccuracy: 1, mistake: 0, blunder: 0 },
  black: { accuracy: 45, acpl: 288, inaccuracy: 0, mistake: 0, blunder: 1 },
  startWin: 51,
  plies: [
    { ply: 1, san: 'e4', uci: 'e2e4', winWhite: 53, cpl: 0, classification: null },
    { ply: 2, san: 'e5', uci: 'e7e5', winWhite: 50, cpl: 0, classification: null },
  ],
};
const moveList: MoveEntryDto[] = [
  { ply: 1, san: 'e4', uci: 'e2e4', classification: null },
  { ply: 2, san: 'e5', uci: 'e7e5', classification: null },
];

describe('ReportPanel', () => {
  it('shows both accuracy numbers and counts', () => {
    const { getByText } = render(ReportPanel, { props: { report, moveList, currentPly: 0 } });
    expect(getByText('92')).toBeTruthy();
    expect(getByText('45')).toBeTruthy();
  });

  it('calls onBack from the back button', async () => {
    const onBack = vi.fn();
    const { getByTestId } = render(ReportPanel, { props: { report, moveList, currentPly: 0, onBack } });
    await fireEvent.click(getByTestId('report-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/ReportPanel.test.ts`
Expected: FAIL — cannot resolve component.

- [ ] **Step 3: Write the component** (reuses `MoveHistory`, `EvalGraph`, `AccuracyDial`)

```svelte
<!-- src/components/ReportPanel.svelte -->
<script lang="ts">
  import AccuracyDial from './AccuracyDial.svelte';
  import EvalGraph from './EvalGraph.svelte';
  import MoveHistory from './MoveHistory.svelte';
  import type { GameReportDto, MoveEntryDto } from '../lib/types';

  export let report: GameReportDto;
  export let moveList: MoveEntryDto[] = [];
  export let currentPly = 0;
  export let onNavigate: (ply: number) => void = () => {};
  export let onBack: () => void = () => {};
  export let onNew: () => void = () => {};

  // Graph wants a win% per position (base + after each move).
  $: wins = [report.startWin, ...report.plies.map((p) => p.winWhite)];
</script>

<div class="card" data-testid="report-panel">
  <div class="pbar">
    <button type="button" class="back" data-testid="report-back" aria-label="Back to analysis" on:click={onBack}>←</button>
    <span class="ptitle">Game Report</span>
  </div>

  <div class="sec dials">
    <AccuracyDial percent={report.white.accuracy} label="White" side="white" />
    <AccuracyDial percent={report.black.accuracy} label="Black" side="black" />
  </div>

  <div class="sec">
    <p class="glabel">Evaluation · white winning chances</p>
    <EvalGraph {wins} {currentPly} {onNavigate} />
  </div>

  <div class="sec">
    <table class="counts">
      <tr><th class="rowh">&nbsp;</th><th>?!</th><th>?</th><th>??</th><th>ACPL</th></tr>
      <tr><td class="rowh"><span class="dot white"></span>White</td>
        <td>{report.white.inaccuracy}</td><td>{report.white.mistake}</td><td>{report.white.blunder}</td><td>{report.white.acpl}</td></tr>
      <tr><td class="rowh"><span class="dot black"></span>Black</td>
        <td>{report.black.inaccuracy}</td><td>{report.black.mistake}</td><td>{report.black.blunder}</td><td>{report.black.acpl}</td></tr>
    </table>
  </div>

  <div class="sec grow">
    <MoveHistory {moveList} {currentPly} {onNavigate} />
  </div>

  <div class="sec acts">
    <button type="button" class="new" on:click={onNew}>New analysis</button>
  </div>
</div>

<style>
  .card { background: var(--card); border: 1px solid var(--keyline); border-radius: 8px;
    box-shadow: 0 1px 0 #fff inset, 0 12px 30px -24px rgba(40,30,15,.45);
    display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
  .pbar { display: flex; align-items: center; gap: 10px; padding: 11px 15px; border-bottom: 1px solid var(--keyline); }
  .back { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--keyline-2);
    border-radius: 7px; background: var(--paper-2); color: var(--ink-2); font-size: 15px; cursor: pointer; }
  .back:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .ptitle { font-family: var(--mono); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2); font-weight: 700; }
  .sec { padding: 16px; } .sec + .sec { border-top: 1px solid var(--keyline); }
  .dials { display: flex; align-items: center; justify-content: space-around; }
  .grow { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 6px; }
  .glabel { font-family: var(--mono); font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 7px; }
  .counts { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .counts th { font-family: var(--mono); font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-faint); font-weight: 700; text-align: right; padding: 4px 6px; }
  .counts th.rowh { text-align: left; }
  .counts td { text-align: right; padding: 5px 6px; font-variant-numeric: tabular-nums; color: var(--ink-2); }
  .counts td.rowh { text-align: left; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 7px; }
  .counts tr + tr td { border-top: 1px solid var(--keyline); }
  .dot { width: 9px; height: 9px; border-radius: 50%; border: 1px solid var(--keyline-2); display: inline-block; }
  .dot.white { background: #f7f3ea; } .dot.black { background: #2b2823; }
  .acts { display: flex; justify-content: center; }
  .new { padding: 9px 16px; border: 1px solid var(--keyline-2); border-radius: 8px; background: var(--paper-2);
    font-family: var(--sans); font-weight: 600; font-size: 13px; color: var(--ink-2); cursor: pointer; }
  .new:hover { border-color: var(--green); color: var(--green); background: #fff; }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/ReportPanel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReportPanel.svelte src/tests/ReportPanel.test.ts
git commit -m "feat(report): ReportPanel — dials, counts, eval graph, reused move list"
```

---

### Task 14: Report screen + trigger button in `App.svelte`

**Files:**
- Modify: `src/App.svelte`
- Test: `src/tests/App.test.ts` (extend — assert the trigger button appears in analysis)

- [ ] **Step 1: Write the failing test**

```ts
// append to src/tests/App.test.ts (import render/fireEvent already present there;
// if not, add: import { render, fireEvent } from '@testing-library/svelte'; import App from '../App.svelte';)
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import App from '../App.svelte';
import { report as reportStore } from '../lib/engineClient';

describe('App report flow', () => {
  it('shows a Request-computer-analysis trigger once in analysis', async () => {
    const { getByTestId, queryByTestId } = render(App);
    // enter analysis via Explore
    await fireEvent.click(getByTestId('home-panel').querySelector('button:nth-child(2)')!);
    expect(queryByTestId('request-analysis')).toBeTruthy();
  });

  it('switches to the report screen when a report arrives', async () => {
    const { getByTestId, queryByTestId } = render(App);
    await fireEvent.click(getByTestId('home-panel').querySelector('button:nth-child(2)')!);
    reportStore.set({
      white: { accuracy: 90, acpl: 20, inaccuracy: 0, mistake: 0, blunder: 0 },
      black: { accuracy: 80, acpl: 30, inaccuracy: 0, mistake: 0, blunder: 0 },
      startWin: 51, plies: [],
    });
    // allow the reactive subscription to run
    await Promise.resolve();
    expect(queryByTestId('report-panel')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/App.test.ts`
Expected: FAIL — no `request-analysis` element; no `report-panel`.

- [ ] **Step 3: Modify `App.svelte`**

Imports and screen type:

```ts
import ReportPanel from './components/ReportPanel.svelte';
import { state, errorSeq, regionShot, report, reportProgress, connect, send } from './lib/engineClient';
```

Change the `Screen` type and add report state:

```ts
type Screen = 'home' | 'analysis' | 'edit' | 'report';
```

Add reactive bridges (near the other `$:`):

```ts
let lastReport: import('./lib/types').GameReportDto | null = null;
$: rpt = $report;
$: progress = $reportProgress;
// Enter the report screen ONLY when a NEW report object arrives (report.set makes
// a fresh object). Guarding on identity prevents the reactive from re-switching to
// 'report' the instant onReportBack sets screen back to 'analysis' while rpt is still set.
$: if (rpt && rpt !== lastReport) { lastReport = rpt; if (screen === 'analysis') screen = 'report'; }

function onRequestAnalysis(): void { send({ type: 'analyze_game' }); }
function onCancelAnalysis(): void { send({ type: 'cancel_analysis' }); }
function onReportBack(): void { screen = 'analysis'; }
```

Make `onNew` also clear the report and return home:

```ts
function onNew(): void {
  screen = 'home';
  manualFlip = false;
  report.set(null);
  send({ type: 'set_analysis_enabled', enabled: false });
  send({ type: 'reset' });
}
```

In the analysis card, add the trigger just below the `EngineHeader`'s `.sec` (before move-history), showing a progress bar while a batch runs:

```svelte
          <div class="sec">
            <div class="bd">
              {#if progress}
                <div class="analyzing" data-testid="analysis-progress">
                  <div class="bar"><div class="fill" style="width:{Math.round((progress.done / progress.total) * 100)}%"></div></div>
                  <button type="button" class="cancel" on:click={onCancelAnalysis}>Cancel · {progress.done}/{progress.total}</button>
                </div>
              {:else}
                <button type="button" class="request" data-testid="request-analysis" on:click={onRequestAnalysis}>Request computer analysis</button>
              {/if}
            </div>
          </div>
```

Add the report screen branch in the panel (alongside the `home`/`edit`/analysis branches). Change the panel `{#if}` chain so it reads:

```svelte
      {#if screen === 'home'}
        <HomePanel ... />
      {:else if screen === 'edit'}
        <EditPanel ... />
      {:else if screen === 'report' && rpt}
        <ReportPanel report={rpt} moveList={s?.moveList ?? []} currentPly={s?.currentPly ?? 0}
          {onNavigate} onBack={onReportBack} onNew={onNew} />
      {:else}
        <section class="card" data-testid="analysis-card"> ... </section>
      {/if}
```

Add styles (in the `<style>` block):

```css
  .request { width: 100%; padding: 12px; border: 1px solid var(--keyline-2); border-radius: 9px;
    background: var(--paper-2); font-family: var(--sans); font-weight: 700; font-size: 13.5px;
    color: var(--green); cursor: pointer; transition: .14s; }
  .request:hover { border-color: var(--green); background: #fff; }
  .analyzing { display: flex; flex-direction: column; gap: 8px; }
  .bar { height: 8px; border-radius: 5px; background: var(--keyline); overflow: hidden; }
  .fill { height: 100%; background: var(--green); transition: width .2s; }
  .cancel { align-self: center; padding: 6px 12px; border: 1px solid var(--keyline-2); border-radius: 7px;
    background: var(--paper-2); font-family: var(--mono); font-size: 11px; color: var(--ink-2); cursor: pointer; }
```

> If `HomePanel` has no `data-testid="home-panel"` selector shape the test needs,
> the test may target the Explore button differently; adapt the selector to the
> actual markup (the button labelled "Explore"). Keep the assertion on
> `request-analysis` / `report-panel`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/App.test.ts && npm run check`
Expected: PASS; `check` 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte src/tests/App.test.ts
git commit -m "feat(report): Report screen + Request-computer-analysis trigger and progress"
```

---

## Final verification

- [ ] **Full test suite**

Run: `npm test`
Expected: all green (existing + new).

- [ ] **Typecheck + svelte-check**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Manual desktop smoke (human gate)**

Run: `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`. Then:
1. Paste a PGN in the Home box → Start Analysis → the game loads (move list populated, board steps through).
2. Click **Request computer analysis** → progress bar advances → Report screen shows two accuracy dials, the eval graph, counts, and the move list.
3. Click a move / the eval graph → board follows and shows the on-board classification badge for that ply.
4. Open **Set Up Position**, drag a piece → the PGN box updates to a `[SetUp "1"]`/`[FEN ...]` PGN reflecting the board.
5. Cross-check one game's accuracy % against the same PGN on lichess.org (analysis board → "Request a computer analysis") — numbers should be within a point or two (engine depth differs).

---

## Self-review notes (author)

- **Spec coverage:** PGN parse (T3) + makePositionPgn (T1) + looksLikePgn (T1) + load (T4); Win%/accuracy (T5–T7); classification reconciliation incl. mate branch (T8); batch driver + report build (T9–T10); Report screen with dials/graph/counts/jump-to-ply + on-board badges via reused MoveHistory/BoardBadge (T11–T14); editor live PGN (T2). All spec sections mapped.
- **Type consistency:** `ParsedGame`, `GameReportDto`/`PlyReportDto`/`PlayerReportDto`, `reportProgress`, and command names (`load_pgn`/`analyze_game`/`cancel_analysis`) are used identically across tasks. `gameAccuracy(startWhite, cpsAfterMoves)` vs `acpl(cpsPositions, startWhite, color)` — the batch builder passes `cpsPositions.slice(1)` to the former and the full array to the latter (documented in T10).
- **Known best-effort:** the batch sets MultiPV=2 via `engine.setOption` (no-op if the engine isn't loaded yet); "Great" only appears when 2 lines are available. Restored to the prior override (or '1') on finish/cancel.
- **Non-goals honored:** first game only; mainline only; no DnD file import; report not persisted.
