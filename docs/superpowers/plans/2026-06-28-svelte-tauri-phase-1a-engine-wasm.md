# Svelte + Tauri Migration — Phase 1a: Engine in the Browser (stockfish.wasm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained TypeScript engine module in the existing `frontend/` project that runs **stockfish.wasm** in a worker and exposes a streaming, throttled, cancellable multi-PV analysis API — the browser replacement for the Python `EngineManager` + `AnalysisSession`.

**Architecture:** Three deterministic, unit-tested pieces — `engine/types.ts` (white-POV `Eval`/`Line`/`AnalysisInfo` as plain data + helper functions), `engine/uci.ts` (pure UCI `info`-line parsing → `AnalysisInfo`), and `engine/session.ts` (a `UciEngine`-driven state machine handling the `stop → isready/readyok → position/go` choreography, throttling, cancellation, and natural-completion `onDone`) — plus `engine/engine.ts` (`UciEngine` interface, a `WorkerEngine` wrapping the real wasm worker, and `loadStockfish()` variant selection). The pure pieces are TDD'd against a `FakeEngine`; the real wasm bootstrap is validated by a guarded smoke test.

**Tech Stack:** TypeScript, Svelte 5 project (Vite + Vitest, already set up in `frontend/`), the `stockfish` npm package (nmrugg/stockfish.js, SF18 WASM). No chess.js needed in this phase (side-to-move is read straight from the FEN). No Tauri yet — this runs under `vite dev` / `vitest`.

**Spec:** `docs/superpowers/specs/2026-06-28-svelte-tauri-migration-design.md` (§5 engine, §9 Phase 1).

**Conventions (match the existing repo):**
- Tests live in `frontend/src/tests/`, named `<thing>.test.ts`, run with `cd frontend && npm run test` (Vitest).
- Run one test file: `cd frontend && npx vitest run src/tests/uci.test.ts`.
- Engine module source lives under `frontend/src/engine/` (new directory).
- Plain-data interfaces + standalone functions (mirrors the existing `lib/types.ts` DTO style), NOT classes, so values are worker/structured-clone safe.

**Scope boundary:** This phase delivers the engine module + tests + a real-engine smoke test. It does NOT wire the engine into the UI or replace the WebSocket — that is **Phase 1b** (orchestrator + classify + UI cutover). The deliverable here is "given a FEN and options, stream `AnalysisInfo` snapshots and stop on demand," proven by the smoke test.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/engine/types.ts` | `Eval`, `Line`, `AnalysisInfo` interfaces + helpers (`toWhitePov`, `evalScalar`, `evalPov`, `formatWhiteEval`, `bestLine`, `lineMove`). Port of `chessmenthol/engine/types.py`. |
| `frontend/src/engine/uci.ts` | Pure UCI parsing: `parseInfoLine`, `buildAnalysisInfo`, `goLimitString`, `sideToMoveIsWhite`. |
| `frontend/src/engine/engine.ts` | `UciEngine` interface; `WorkerEngine` (wraps the wasm worker); `loadStockfish()` (variant select via SAB detect) + `configure()`. |
| `frontend/src/engine/session.ts` | `AnalysisSession` — drives a `UciEngine` (handshake state machine, throttle, cancel, `onDone`). Port of `AnalysisSession` + `EngineManager.stream_analysis`. |
| `frontend/src/tests/engineTypes.test.ts` | Unit tests for `types.ts`. |
| `frontend/src/tests/uci.test.ts` | Unit tests for `uci.ts`. |
| `frontend/src/tests/session.test.ts` | Unit tests for `session.ts` via a `FakeEngine`. |
| `frontend/src/tests/engineLoad.smoke.test.ts` | Guarded smoke test against the real `stockfish.wasm`. |
| `frontend/scripts/copy-engine.mjs` | Copies `stockfish` dist files into `public/engine/` + writes `engine-manifest.json`. Wired as `predev`/`prebuild`. |
| `frontend/vite.config.ts` (modify) | Add COOP/COEP dev headers so the threaded variant can use `SharedArrayBuffer` under `vite dev`. |
| `frontend/package.json` (modify) | Add `stockfish` dep + `predev`/`prebuild` copy hooks. |

---

## Task 0: Install the engine package and scaffold

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the `stockfish` package**

Run:
```bash
cd frontend && npm install stockfish
```
Expected: `stockfish` appears under `dependencies` in `frontend/package.json`; install succeeds.

- [ ] **Step 2: Discover the exact dist filenames (version-pinned)**

Run:
```bash
cd frontend && ls node_modules/stockfish/bin
```
Expected (confirmed for `stockfish@18.0.8`): the dist lives in **`bin/`** (not `src/`). The **lite single-threaded** build is `stockfish-18-lite-single.js` (+ `.wasm`); the **lite multi-threaded** build is `stockfish-18-lite.js` (+ `.wasm`) — note it has **no `multi`/`mt` token**; it is simply the lite `.js` *without* `single`. The copy script in Task 6 discovers these by pattern (multi = lite `.js` lacking `single`), so no version number is hardcoded.

- [ ] **Step 3: Create the engine source directory**

Run:
```bash
cd frontend && mkdir -p src/engine scripts
```
Expected: `frontend/src/engine/` and `frontend/scripts/` exist.

- [ ] **Step 4: Commit**

```bash
cd frontend && git add package.json package-lock.json && git commit -m "chore(frontend): add stockfish wasm dependency for engine port"
```

---

## Task 1: Analysis types (`engine/types.ts`)

Port `chessmenthol/engine/types.py`. All evals are **White's point of view** (cp positive = White better; mate positive = White mates), exactly as the Python `Eval`.

**Files:**
- Create: `frontend/src/engine/types.ts`
- Test: `frontend/src/tests/engineTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/tests/engineTypes.test.ts
import { describe, it, expect } from 'vitest';
import {
  toWhitePov, evalScalar, evalPov, formatWhiteEval, bestLine, lineMove,
  type Eval, type Line, type AnalysisInfo,
} from '../engine/types';

describe('toWhitePov', () => {
  it('keeps side-to-move score when white to move', () => {
    expect(toWhitePov(34, null, true)).toEqual({ cp: 34, mate: null });
    expect(toWhitePov(null, 3, true)).toEqual({ cp: null, mate: 3 });
  });
  it('negates score when black to move', () => {
    expect(toWhitePov(34, null, false)).toEqual({ cp: -34, mate: null });
    expect(toWhitePov(null, 3, false)).toEqual({ cp: null, mate: -3 });
    expect(toWhitePov(null, -2, false)).toEqual({ cp: null, mate: 2 });
  });
});

describe('evalScalar / evalPov', () => {
  it('returns cp directly for non-mate', () => {
    expect(evalScalar({ cp: 120, mate: null })).toBe(120);
    expect(evalScalar({ cp: -45, mate: null })).toBe(-45);
  });
  it('maps mate near +/- mate_value, sooner mate = larger magnitude', () => {
    expect(evalScalar({ cp: null, mate: 1 })).toBe(99_999);
    expect(evalScalar({ cp: null, mate: 5 })).toBe(99_995);
    expect(evalScalar({ cp: null, mate: -1 })).toBe(-99_999);
  });
  it('treats empty eval as 0', () => {
    expect(evalScalar({ cp: null, mate: null })).toBe(0);
  });
  it('evalPov flips sign for black', () => {
    expect(evalPov({ cp: 50, mate: null }, true)).toBe(50);
    expect(evalPov({ cp: 50, mate: null }, false)).toBe(-50);
  });
});

describe('formatWhiteEval', () => {
  it('formats centipawns to 2 decimals with sign', () => {
    expect(formatWhiteEval({ cp: 34, mate: null })).toBe('+0.34');
    expect(formatWhiteEval({ cp: -150, mate: null })).toBe('-1.50');
    expect(formatWhiteEval({ cp: 0, mate: null })).toBe('+0.00');
  });
  it('formats mate', () => {
    expect(formatWhiteEval({ cp: null, mate: 3 })).toBe('+M3');
    expect(formatWhiteEval({ cp: null, mate: -2 })).toBe('-M2');
    expect(formatWhiteEval({ cp: null, mate: 0 })).toBe('#');
  });
});

describe('bestLine / lineMove', () => {
  const mk = (multipv: number, pv: string[]): Line =>
    ({ multipv, eval: { cp: 0, mate: null }, depth: 10, pv });
  it('bestLine returns the multipv===1 line (lines[0])', () => {
    const info: AnalysisInfo = { fen: 'x', depth: 10, lines: [mk(1, ['e2e4']), mk(2, ['d2d4'])] };
    expect(bestLine(info)?.multipv).toBe(1);
  });
  it('bestLine is null when no lines', () => {
    expect(bestLine({ fen: 'x', depth: 0, lines: [] })).toBeNull();
  });
  it('lineMove returns first pv move or null', () => {
    expect(lineMove(mk(1, ['e2e4', 'e7e5']))).toBe('e2e4');
    expect(lineMove(mk(1, []))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/engineTypes.test.ts`
Expected: FAIL — cannot resolve `../engine/types`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/engine/types.ts
// White's-point-of-view analysis types. Port of chessmenthol/engine/types.py.
// Plain data (no classes) so values survive structured clone / Svelte stores.

export interface Eval {
  cp: number | null;   // centipawns, White POV (null when forced mate)
  mate: number | null; // mate-in-N, White POV (positive = White mates)
}

export interface Line {
  multipv: number;     // 1-based rank; 1 === best line
  eval: Eval;
  depth: number;
  pv: string[];        // UCI moves, e.g. ['e2e4','e7e5']
}

export interface AnalysisInfo {
  fen: string;
  depth: number;       // max depth across lines
  lines: Line[];       // sorted ascending by multipv (lines[0] === best)
}

const MATE_VALUE = 100_000;

/** Convert a side-to-move-relative score to White POV. */
export function toWhitePov(cp: number | null, mate: number | null, whiteToMove: boolean): Eval {
  if (whiteToMove) return { cp, mate };
  return { cp: cp === null ? null : -cp, mate: mate === null ? null : -mate };
}

/** White-POV centipawn scalar; mate mapped near +/- MATE_VALUE. */
export function evalScalar(e: Eval, mateValue = MATE_VALUE): number {
  if (e.mate !== null) {
    const base = mateValue - Math.abs(e.mate);
    return e.mate > 0 ? base : -base;
  }
  return e.cp ?? 0;
}

/** Scalar from the perspective of the side to move. */
export function evalPov(e: Eval, whiteToMove: boolean, mateValue = MATE_VALUE): number {
  const s = evalScalar(e, mateValue);
  return whiteToMove ? s : -s;
}

/** White-POV display string, e.g. '+0.34', '-1.50', '+M3', '#'. */
export function formatWhiteEval(e: Eval): string {
  if (e.mate !== null) {
    if (e.mate > 0) return `+M${e.mate}`;
    if (e.mate < 0) return `-M${-e.mate}`;
    return '#';
  }
  const pawns = (e.cp ?? 0) / 100;
  const sign = pawns >= 0 ? '+' : '-';
  return `${sign}${Math.abs(pawns).toFixed(2)}`;
}

export function bestLine(info: AnalysisInfo): Line | null {
  return info.lines.length ? info.lines[0] : null;
}

export function lineMove(line: Line): string | null {
  return line.pv.length ? line.pv[0] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/engineTypes.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/engine/types.ts src/tests/engineTypes.test.ts && git commit -m "feat(engine): white-POV analysis types (port of engine/types.py)"
```

---

## Task 2: UCI `info`-line parsing (`engine/uci.ts` part 1)

`parseInfoLine` turns one raw engine `info` line into a partial line record (side-to-move-relative score). Lines without a `score` token are skipped (return `null`) — mirrors the Python stream filtering `info string`/score-less updates.

**Files:**
- Create: `frontend/src/engine/uci.ts`
- Test: `frontend/src/tests/uci.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/tests/uci.test.ts
import { describe, it, expect } from 'vitest';
import { parseInfoLine, sideToMoveIsWhite, goLimitString, buildAnalysisInfo } from '../engine/uci';

describe('sideToMoveIsWhite', () => {
  it('reads the side field from a FEN', () => {
    expect(sideToMoveIsWhite('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(true);
    expect(sideToMoveIsWhite('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1')).toBe(false);
  });
  it('defaults to white on a malformed FEN', () => {
    expect(sideToMoveIsWhite('garbage')).toBe(true);
  });
});

describe('parseInfoLine', () => {
  it('parses depth, multipv, cp score and pv', () => {
    const line = 'info depth 20 seldepth 28 multipv 1 score cp 31 nodes 100 nps 50 time 200 pv e2e4 e7e5 g1f3';
    expect(parseInfoLine(line)).toEqual({ depth: 20, multipv: 1, cp: 31, mate: null, pv: ['e2e4', 'e7e5', 'g1f3'] });
  });
  it('parses mate score', () => {
    const line = 'info depth 12 multipv 2 score mate -3 pv d2d4 d7d5';
    expect(parseInfoLine(line)).toEqual({ depth: 12, multipv: 2, cp: null, mate: -3, pv: ['d2d4', 'd7d5'] });
  });
  it('defaults multipv to 1 and depth to 0 when absent', () => {
    const line = 'info score cp 5 pv e2e4';
    expect(parseInfoLine(line)).toEqual({ depth: 0, multipv: 1, cp: 5, mate: null, pv: ['e2e4'] });
  });
  it('ignores lowerbound/upperbound tokens but keeps the value', () => {
    const line = 'info depth 9 multipv 1 score cp 12 lowerbound pv e2e4';
    expect(parseInfoLine(line)).toEqual({ depth: 9, multipv: 1, cp: 12, mate: null, pv: ['e2e4'] });
  });
  it('returns null for lines without a score', () => {
    expect(parseInfoLine('info depth 1 seldepth 1 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfoLine('info string NNUE evaluation using net.nnue')).toBeNull();
  });
  it('handles an empty pv (score but no moves)', () => {
    expect(parseInfoLine('info depth 30 multipv 1 score cp 0')).toEqual({ depth: 30, multipv: 1, cp: 0, mate: null, pv: [] });
  });
});

describe('goLimitString', () => {
  it('depth only', () => { expect(goLimitString({ depth: 18, timeMs: null })).toBe('go depth 18'); });
  it('movetime only', () => { expect(goLimitString({ depth: null, timeMs: 10000 })).toBe('go movetime 10000'); });
  it('both', () => { expect(goLimitString({ depth: 18, timeMs: 5000 })).toBe('go depth 18 movetime 5000'); });
  it('neither -> infinite', () => { expect(goLimitString({ depth: null, timeMs: null })).toBe('go infinite'); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/uci.test.ts`
Expected: FAIL — cannot resolve `../engine/uci`.

- [ ] **Step 3: Write the implementation (parse + helpers; `buildAnalysisInfo` added in Task 3)**

```ts
// frontend/src/engine/uci.ts
import type { AnalysisInfo, Eval, Line } from './types';
import { toWhitePov } from './types';

export interface ParsedInfo {
  depth: number;
  multipv: number;
  cp: number | null;   // side-to-move relative (convert with toWhitePov)
  mate: number | null; // side-to-move relative
  pv: string[];
}

/** Side to move from a FEN's 2nd field; defaults to White if malformed. */
export function sideToMoveIsWhite(fen: string): boolean {
  return fen.split(' ')[1] !== 'b';
}

/** Parse one UCI `info` line. Returns null if it carries no score. */
export function parseInfoLine(line: string): ParsedInfo | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'info') return null;
  let depth = 0;
  let multipv = 1;
  let cp: number | null = null;
  let mate: number | null = null;
  let pv: string[] = [];
  let hasScore = false;
  for (let i = 1; i < t.length; i++) {
    const tok = t[i];
    if (tok === 'depth') { depth = parseInt(t[++i], 10); }
    else if (tok === 'multipv') { multipv = parseInt(t[++i], 10); }
    else if (tok === 'score') {
      const kind = t[++i];
      const val = parseInt(t[++i], 10);
      if (kind === 'cp') { cp = val; mate = null; hasScore = true; }
      else if (kind === 'mate') { mate = val; cp = null; hasScore = true; }
    }
    else if (tok === 'pv') { pv = t.slice(i + 1); break; } // pv is always last
    // everything else (seldepth, nodes, nps, hashfull, tbhits, time,
    // currmove, currmovenumber, lowerbound, upperbound, ...) is ignored
  }
  if (!hasScore) return null;
  return { depth, multipv, cp, mate, pv };
}

export interface GoLimit { depth: number | null; timeMs: number | null; }

/** Build the UCI `go` command from a search limit. */
export function goLimitString(limit: GoLimit): string {
  const parts: string[] = [];
  if (limit.depth !== null) parts.push(`depth ${limit.depth}`);
  if (limit.timeMs !== null) parts.push(`movetime ${limit.timeMs}`);
  return parts.length ? `go ${parts.join(' ')}` : 'go infinite';
}

// buildAnalysisInfo is implemented in Task 3 (kept in this file).
export function buildAnalysisInfo(
  fen: string,
  lineByMultipv: Map<number, ParsedInfo>,
): AnalysisInfo {
  throw new Error('not implemented');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/uci.test.ts`
Expected: PASS for the `sideToMoveIsWhite`, `parseInfoLine`, and `goLimitString` describe-blocks. (No `buildAnalysisInfo` tests yet.)

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/engine/uci.ts src/tests/uci.test.ts && git commit -m "feat(engine): parse UCI info lines + go-limit builder"
```

---

## Task 3: Assemble `AnalysisInfo` from the latest per-multipv lines (`engine/uci.ts` part 2)

`buildAnalysisInfo` takes the latest `ParsedInfo` per multipv index (collected by the session) and a FEN, converts each score to White POV, sorts by multipv, and sets `depth` to the max line depth — exactly like Python `AnalysisInfo.from_engine`.

**Files:**
- Modify: `frontend/src/engine/uci.ts`
- Test: `frontend/src/tests/uci.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to `uci.test.ts`)**

```ts
describe('buildAnalysisInfo', () => {
  it('converts to white POV, sorts by multipv, sets max depth', () => {
    // Black to move: side-to-move cp must be negated to White POV.
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    const m = new Map([
      [2, { depth: 18, multipv: 2, cp: -10, mate: null, pv: ['d7d5'] }],
      [1, { depth: 20, multipv: 1, cp: 40, mate: null, pv: ['e7e5'] }],
    ]);
    const info = buildAnalysisInfo(fen, m);
    expect(info.fen).toBe(fen);
    expect(info.depth).toBe(20);
    expect(info.lines.map((l) => l.multipv)).toEqual([1, 2]);
    expect(info.lines[0]).toEqual({ multipv: 1, eval: { cp: -40, mate: null }, depth: 20, pv: ['e7e5'] });
    expect(info.lines[1].eval).toEqual({ cp: 10, mate: null });
  });
  it('white to move keeps the sign; mate converts too', () => {
    const fen = '7k/8/8/8/8/8/8/6QK w - - 0 1';
    const m = new Map([[1, { depth: 5, multipv: 1, cp: null, mate: 2, pv: ['g1g7'] }]]);
    const info = buildAnalysisInfo(fen, m);
    expect(info.lines[0].eval).toEqual({ cp: null, mate: 2 });
  });
  it('empty map -> no lines, depth 0', () => {
    const info = buildAnalysisInfo('x w - - 0 1', new Map());
    expect(info.lines).toEqual([]);
    expect(info.depth).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/uci.test.ts`
Expected: FAIL — `buildAnalysisInfo` throws `not implemented`.

- [ ] **Step 3: Replace the stub `buildAnalysisInfo` with the implementation**

```ts
export function buildAnalysisInfo(
  fen: string,
  lineByMultipv: Map<number, ParsedInfo>,
): AnalysisInfo {
  const whiteToMove = sideToMoveIsWhite(fen);
  const lines: Line[] = [];
  for (const p of lineByMultipv.values()) {
    const ev: Eval = toWhitePov(p.cp, p.mate, whiteToMove);
    lines.push({ multipv: p.multipv, eval: ev, depth: p.depth, pv: p.pv });
  }
  lines.sort((a, b) => a.multipv - b.multipv);
  const depth = lines.reduce((mx, l) => Math.max(mx, l.depth), 0);
  return { fen, depth, lines };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/uci.test.ts`
Expected: PASS (all describe-blocks, including `buildAnalysisInfo`).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/engine/uci.ts src/tests/uci.test.ts && git commit -m "feat(engine): assemble white-POV AnalysisInfo from multipv lines"
```

---

## Task 4: `UciEngine` interface (`engine/engine.ts` part 1)

A tiny seam so the session can be driven by either the real wasm worker or a `FakeEngine` in tests.

**Files:**
- Create: `frontend/src/engine/engine.ts`

- [ ] **Step 1: Write the interface (no test yet — exercised via the session in Task 5)**

```ts
// frontend/src/engine/engine.ts
// UciEngine: a minimal text-in / line-out seam over a UCI engine.
// Implementations: WorkerEngine (real wasm, Task 6) and FakeEngine (tests, Task 5).

export interface UciEngine {
  /** Send a single UCI command line (no trailing newline needed). */
  send(cmd: string): void;
  /** Register a listener for engine output lines (one line per call). */
  onLine(cb: (line: string) => void): void;
  /** Quit + release resources. Idempotent. */
  dispose(): void;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors from `engine.ts`.

- [ ] **Step 3: Commit**

```bash
cd frontend && git add src/engine/engine.ts && git commit -m "feat(engine): UciEngine text-in/line-out interface"
```

---

## Task 5: `AnalysisSession` — streaming, throttle, cancel, done (`engine/session.ts`)

Ports `AnalysisSession` (`server/session.py`) + the `stream_analysis` setup (`engine/manager.py`). Event-driven (no threads): drives a `UciEngine` through the safe handshake `stop → isready → readyok → position/go`, collects `info` lines into a per-multipv map, emits throttled `AnalysisInfo` via `onUpdate`, flushes the final snapshot and calls `onDone` on **natural** completion (a `bestmove` while actively searching), and ignores all stale output after `stop()` or a superseding `start()`.

**State machine:** `IDLE → (start) WAITING_READY → (readyok) SEARCHING → (bestmove) IDLE`. Only `SEARCHING` processes `info`/`bestmove`; this is what makes the stale `bestmove` from a stopped search harmless.

**Throttle (faithful to `session.py`, timer-less):** keep a `pending` snapshot; emit immediately when `now() - lastEmit >= throttleMs`, otherwise hold it; always flush `pending` on natural completion. `now` is injected for deterministic tests.

**Files:**
- Create: `frontend/src/engine/session.ts`
- Test: `frontend/src/tests/session.test.ts`

- [ ] **Step 1: Write the failing test (includes an inline `FakeEngine`)**

```ts
// frontend/src/tests/session.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AnalysisSession } from '../engine/session';
import type { UciEngine } from '../engine/engine';
import type { AnalysisInfo } from '../engine/types';

class FakeEngine implements UciEngine {
  sent: string[] = [];
  private cb: ((line: string) => void) | null = null;
  send(cmd: string): void {
    this.sent.push(cmd);
    if (cmd === 'isready') this.emit('readyok'); // synchronous handshake for tests
  }
  onLine(cb: (line: string) => void): void { this.cb = cb; }
  dispose(): void {}
  emit(line: string): void { this.cb?.(line); }
  last(): string { return this.sent[this.sent.length - 1]; }
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function makeSession(eng: UciEngine, now: () => number, onUpdate: (a: AnalysisInfo) => void, onDone?: () => void) {
  return new AnalysisSession(eng, { onUpdate, onDone, throttleMs: 100, now });
}

describe('AnalysisSession handshake + go', () => {
  it('sends setoption MultiPV, isready, then position+go on readyok', () => {
    const eng = new FakeEngine();
    const s = makeSession(eng, () => 0, () => {});
    s.start(START_FEN, { depth: 18, multipv: 3, timeMs: null });
    expect(eng.sent).toEqual([
      'setoption name MultiPV value 3',
      'isready',
      `position fen ${START_FEN}`,
      'go depth 18',
    ]);
  });
});

describe('AnalysisSession streaming + throttle', () => {
  it('emits on first info, throttles within the window, accumulates multipv', () => {
    const eng = new FakeEngine();
    let t = 0;
    const updates: AnalysisInfo[] = [];
    const s = makeSession(eng, () => t, (a) => updates.push(a));
    s.start(START_FEN, { depth: 30, multipv: 2, timeMs: null });

    t = 0;   eng.emit('info depth 10 multipv 1 score cp 20 pv e2e4');   // first -> emit
    t = 50;  eng.emit('info depth 10 multipv 2 score cp 10 pv d2d4');   // within window -> held
    t = 120; eng.emit('info depth 11 multipv 1 score cp 25 pv e2e4 e7e5'); // window passed -> emit

    expect(updates).toHaveLength(2);
    expect(updates[0].lines.map((l) => l.multipv)).toEqual([1]);
    expect(updates[1].lines.map((l) => l.multipv)).toEqual([1, 2]); // multipv 2 accumulated
    expect(updates[1].depth).toBe(11);
    expect(updates[1].lines[0].pv).toEqual(['e2e4', 'e7e5']);
  });

  it('flushes the final pending snapshot and fires onDone on bestmove', () => {
    const eng = new FakeEngine();
    let t = 0;
    const updates: AnalysisInfo[] = [];
    const done = vi.fn();
    const s = makeSession(eng, () => t, (a) => updates.push(a), done);
    s.start(START_FEN, { depth: 5, multipv: 1, timeMs: null });

    t = 0;  eng.emit('info depth 4 multipv 1 score cp 12 pv e2e4'); // emitted
    t = 10; eng.emit('info depth 5 multipv 1 score cp 15 pv e2e4'); // held (within window)
    eng.emit('bestmove e2e4');

    expect(updates).toHaveLength(2);          // first + flushed final
    expect(updates[1].depth).toBe(5);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('ignores info lines that carry no score', () => {
    const eng = new FakeEngine();
    const updates: AnalysisInfo[] = [];
    const s = makeSession(eng, () => 1000, (a) => updates.push(a));
    s.start(START_FEN, { depth: 5, multipv: 1, timeMs: null });
    eng.emit('info string hello');
    eng.emit('info depth 1 currmove e2e4 currmovenumber 1');
    expect(updates).toHaveLength(0);
  });
});

describe('AnalysisSession cancellation', () => {
  it('stop() sends stop, suppresses onDone, and ignores the stale bestmove', () => {
    const eng = new FakeEngine();
    const updates: AnalysisInfo[] = [];
    const done = vi.fn();
    const s = makeSession(eng, () => 1000, (a) => updates.push(a), done);
    s.start(START_FEN, { depth: 30, multipv: 1, timeMs: null });
    eng.emit('info depth 10 multipv 1 score cp 5 pv e2e4');
    s.stop();
    expect(eng.last()).toBe('stop');
    eng.emit('bestmove e2e4'); // stale -> ignored
    expect(done).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1); // only the pre-stop emit
  });

  it('a superseding start() sends stop and ignores the prior search bestmove', () => {
    const eng = new FakeEngine();
    const done = vi.fn();
    const s = makeSession(eng, () => 1000, () => {}, done);
    s.start(START_FEN, { depth: 30, multipv: 1, timeMs: null });
    eng.emit('info depth 10 multipv 1 score cp 5 pv e2e4');
    const otherFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    s.start(otherFen, { depth: 30, multipv: 1, timeMs: null });
    expect(eng.sent).toContain('stop');
    eng.emit('bestmove e2e4'); // belongs to the stopped first search -> ignored (WAITING_READY)
    expect(done).not.toHaveBeenCalled();
    // the readyok from the second start's isready already issued position+go for otherFen
    expect(eng.sent).toContain(`position fen ${otherFen}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/session.test.ts`
Expected: FAIL — cannot resolve `../engine/session`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/engine/session.ts
import type { UciEngine } from './engine';
import type { AnalysisInfo } from './types';
import { buildAnalysisInfo, goLimitString, parseInfoLine, type ParsedInfo, type GoLimit } from './uci';

export interface StartOptions { depth: number | null; multipv: number; timeMs: number | null; }

export interface SessionCallbacks {
  onUpdate: (info: AnalysisInfo) => void;
  onDone?: () => void;
  throttleMs?: number;
  now?: () => number;
}

type Phase = 'idle' | 'waiting_ready' | 'searching';

export class AnalysisSession {
  private readonly engine: UciEngine;
  private readonly onUpdate: (info: AnalysisInfo) => void;
  private readonly onDone?: () => void;
  private readonly throttleMs: number;
  private readonly now: () => number;

  private phase: Phase = 'idle';
  private fen = '';
  private limit: GoLimit = { depth: null, timeMs: null };
  private lines = new Map<number, ParsedInfo>();
  private pending: AnalysisInfo | null = null;
  private lastEmit = 0;
  private lastMultipv = -1;

  constructor(engine: UciEngine, cb: SessionCallbacks) {
    this.engine = engine;
    this.onUpdate = cb.onUpdate;
    this.onDone = cb.onDone;
    this.throttleMs = cb.throttleMs ?? 100;
    this.now = cb.now ?? (() => performance.now());
    this.engine.onLine((line) => this.handleLine(line));
  }

  start(fen: string, opts: StartOptions): void {
    // Cancel any in-flight search first; its trailing bestmove will arrive while
    // we are WAITING_READY and is therefore ignored.
    if (this.phase === 'searching') this.engine.send('stop');
    this.fen = fen;
    this.limit = { depth: opts.depth, timeMs: opts.timeMs };
    this.lines = new Map();
    this.pending = null;
    this.lastEmit = 0;
    this.phase = 'waiting_ready';
    if (opts.multipv !== this.lastMultipv) {
      this.engine.send(`setoption name MultiPV value ${opts.multipv}`);
      this.lastMultipv = opts.multipv;
    }
    // isready barrier: drains any stopped search's bestmove before our position/go.
    this.engine.send('isready');
  }

  stop(): void {
    if (this.phase === 'searching') this.engine.send('stop');
    this.phase = 'idle';      // subsequent readyok/bestmove are ignored
    this.pending = null;
  }

  dispose(): void {
    this.stop();
    this.engine.dispose();
  }

  private handleLine(line: string): void {
    if (line === 'readyok') {
      if (this.phase === 'waiting_ready') {
        this.engine.send(`position fen ${this.fen}`);
        this.engine.send(goLimitString(this.limit));
        this.phase = 'searching';
      }
      return;
    }
    if (this.phase !== 'searching') return;       // ignore stale output
    if (line.startsWith('bestmove')) {
      this.phase = 'idle';
      if (this.pending) { this.onUpdate(this.pending); this.pending = null; }
      this.onDone?.();
      return;
    }
    if (line.startsWith('info')) {
      const parsed = parseInfoLine(line);
      if (!parsed) return;
      this.lines.set(parsed.multipv, parsed);
      const info = buildAnalysisInfo(this.fen, this.lines);
      const t = this.now();
      if (t - this.lastEmit >= this.throttleMs) {
        this.onUpdate(info);
        this.pending = null;
        this.lastEmit = t;
      } else {
        this.pending = info;
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/session.test.ts`
Expected: PASS (handshake, streaming/throttle, done-flush, cancellation, supersede).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/engine/session.ts src/tests/session.test.ts && git commit -m "feat(engine): AnalysisSession streaming/throttle/cancel (port of session.py)"
```

---

## Task 6: Copy script + dev headers + `WorkerEngine`/`loadStockfish` (`engine/engine.ts` part 2)

Wire the real wasm. The copy script makes the version-pinned dist files servable as static assets and records which build is single- vs multi-threaded; `loadStockfish` picks the threaded build only when `SharedArrayBuffer` is available (the Linux/WebKitGTK-safe fallback from the spec). The real protocol is validated by the smoke test in Task 7 — that is the correctness gate for this task.

**Files:**
- Create: `frontend/scripts/copy-engine.mjs`
- Modify: `frontend/package.json` (add `predev`/`prebuild`)
- Modify: `frontend/vite.config.ts` (COOP/COEP dev headers)
- Modify: `frontend/src/engine/engine.ts` (add `WorkerEngine`, `loadStockfish`, `configure`)

- [ ] **Step 1: Write the copy script**

```js
// frontend/scripts/copy-engine.mjs
// Copies the stockfish dist into public/engine/ and writes engine-manifest.json
// mapping the single- and multi-threaded lite builds. Version-agnostic: it
// classifies by filename, so a stockfish upgrade needs no code change.
import { readdirSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'node_modules', 'stockfish', 'bin'); // stockfish@18 ships dist in bin/
const OUT = join(here, '..', 'public', 'engine');

if (!existsSync(SRC)) { console.error(`[copy-engine] missing ${SRC} — run npm install`); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC);
for (const f of files) copyFileSync(join(SRC, f), join(OUT, f));

// Classify by filename (version-agnostic). stockfish@18: lite-single = single,
// lite (no "single") = multi-threaded. Exclude the asm.js fallback from the JS pool.
const js = files.filter((f) => f.endsWith('.js') && !f.includes('.worker') && !f.includes('asm'));
const lite = js.filter((f) => f.includes('lite'));
const pool = lite.length ? lite : js;
const single = pool.find((f) => f.includes('single'));
const multi = pool.find((f) => !f.includes('single')); // lite build without the "single" token
if (!single) { console.error('[copy-engine] no single-threaded build found in', js); process.exit(1); }

writeFileSync(join(OUT, 'engine-manifest.json'),
  JSON.stringify({ single, multi: multi ?? single }, null, 2));
console.log(`[copy-engine] single=${single} multi=${multi ?? '(none, fallback to single)'}`);
```

- [ ] **Step 2: Run the copy script and verify output**

Run:
```bash
cd frontend && node scripts/copy-engine.mjs && cat public/engine/engine-manifest.json
```
Expected: prints the chosen builds; `public/engine/engine-manifest.json` contains `{"single": "...","multi": "..."}` and `public/engine/` holds the copied `.js`/`.wasm` files.

- [ ] **Step 3: Wire copy as predev/prebuild and ignore the generated dir**

In `frontend/package.json`, add to `scripts`:
```json
    "predev": "node scripts/copy-engine.mjs",
    "prebuild": "node scripts/copy-engine.mjs",
    "copy-engine": "node scripts/copy-engine.mjs"
```
(Add the three keys alongside the existing `dev`/`build` entries.)

Append `public/engine/` to `frontend/.gitignore` (it is generated from `node_modules`):
```bash
cd frontend && printf '\n# generated by scripts/copy-engine.mjs\npublic/engine/\n' >> .gitignore
```

- [ ] **Step 4: Add COOP/COEP dev headers for threaded wasm**

In `frontend/vite.config.ts`, add a `server.headers` block so `SharedArrayBuffer` is available under `vite dev` (required for the multi-threaded build; harmless for single-threaded). Read the file first to find the exported config object, then add:
```ts
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
```
(Merge into the existing `defineConfig({...})` — keep the existing `plugins`/`test` keys.)

- [ ] **Step 5: Add `WorkerEngine` + `loadStockfish` + `configure` to `engine.ts`**

```ts
// Append to frontend/src/engine/engine.ts

/** Wraps a Web Worker that speaks UCI text. */
export class WorkerEngine implements UciEngine {
  private readonly worker: Worker;
  private listener: ((line: string) => void) | null = null;
  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e: MessageEvent) => {
      const data: string = typeof e === 'string' ? e : e.data;
      // stockfish may batch multiple lines in one message
      for (const line of String(data).split('\n')) {
        const trimmed = line.trim();
        if (trimmed) this.listener?.(trimmed);
      }
    };
  }
  send(cmd: string): void { this.worker.postMessage(cmd); }
  onLine(cb: (line: string) => void): void { this.listener = cb; }
  dispose(): void { try { this.worker.postMessage('quit'); } catch { /* ignore */ } this.worker.terminate(); }
}

export interface EngineConfig { threads?: number; hash?: number; }

/** Send Threads/Hash setoptions (presets / user options). */
export function configure(engine: UciEngine, cfg: EngineConfig): void {
  if (cfg.threads != null) engine.send(`setoption name Threads value ${cfg.threads}`);
  if (cfg.hash != null) engine.send(`setoption name Hash value ${cfg.hash}`);
}

/** True when threaded wasm (SharedArrayBuffer) is usable in this context. */
export function threadsAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
    && (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

/**
 * Load stockfish.wasm: pick the threaded build when available, else single-threaded.
 * Resolves once the engine answers `uciok`.
 */
export async function loadStockfish(base = '/engine/'): Promise<UciEngine> {
  const manifest: { single: string; multi: string } =
    await fetch(`${base}engine-manifest.json`).then((r) => r.json());
  const file = threadsAvailable() ? manifest.multi : manifest.single;
  const worker = new Worker(`${base}${file}`);
  const engine = new WorkerEngine(worker);
  await new Promise<void>((resolve) => {
    const onLine = (line: string) => { if (line === 'uciok') resolve(); };
    engine.onLine(onLine);
    engine.send('uci');
  });
  return engine;
}
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd frontend && git add src/engine/engine.ts scripts/copy-engine.mjs package.json .gitignore vite.config.ts && git commit -m "feat(engine): real stockfish.wasm worker + variant selection + dev COOP/COEP"
```

---

## Task 7: Real-engine smoke test (correctness gate for the wasm bootstrap)

A guarded integration test: loads the real wasm and analyses the start position, asserting it streams a sane White-POV eval and a best move. It is **skipped automatically** when the dist is absent (so CI without the copy step stays green), mirroring the repo's `engine`-marked Python tests.

**Files:**
- Create: `frontend/src/tests/engineLoad.smoke.test.ts`

- [ ] **Step 1: Write the smoke test**

```ts
// frontend/src/tests/engineLoad.smoke.test.ts
// Real stockfish.wasm smoke test. Skipped unless public/engine was generated
// (npm run copy-engine) AND a DOM/Worker env is available.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { AnalysisSession } from '../engine/session';
import { loadStockfish } from '../engine/engine';
import type { AnalysisInfo } from '../engine/types';
import { bestLine } from '../engine/types';

const HAVE_DIST = existsSync('public/engine/engine-manifest.json');
const HAVE_WORKER = typeof Worker !== 'undefined' && typeof fetch !== 'undefined';
const maybe = HAVE_DIST && HAVE_WORKER ? describe : describe.skip;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

maybe('stockfish.wasm smoke', () => {
  it('streams a best move + finite eval for the start position', async () => {
    const engine = await loadStockfish();
    try {
      const updates: AnalysisInfo[] = [];
      await new Promise<void>((resolve) => {
        const s = new AnalysisSession(engine, {
          onUpdate: (a) => updates.push(a),
          onDone: () => resolve(),
        });
        s.start(START_FEN, { depth: 10, multipv: 2, timeMs: null });
      });
      const last = updates[updates.length - 1];
      expect(last).toBeDefined();
      const best = bestLine(last);
      expect(best).not.toBeNull();
      expect(best!.pv.length).toBeGreaterThan(0);
      // start position is roughly balanced from White's POV
      expect(best!.eval.cp).not.toBeNull();
      expect(Math.abs(best!.eval.cp!)).toBeLessThan(150);
    } finally {
      engine.dispose();
    }
  }, 30_000);
});
```

- [ ] **Step 2: Generate the dist, then run the smoke test**

Run:
```bash
cd frontend && npm run copy-engine && npx vitest run src/tests/engineLoad.smoke.test.ts
```
Expected: the `stockfish.wasm smoke` test runs (not skipped) and PASSES. If the test environment cannot spawn a `Worker`/`fetch` (jsdom limitation), it auto-skips — in that case verify manually in the browser per Step 3 before considering the task done.

- [ ] **Step 3: Manual browser verification (only if the smoke test auto-skipped)**

If Vitest's jsdom can't run a real `Worker`, prove the engine works in the browser instead:
```bash
cd frontend && npm run dev
```
Then in the running app's DevTools console:
```js
const { loadStockfish } = await import('/src/engine/engine.ts');
const { AnalysisSession } = await import('/src/engine/session.ts');
const e = await loadStockfish();
new AnalysisSession(e, { onUpdate: a => console.log(a.depth, a.lines[0]?.eval, a.lines[0]?.pv?.[0]), onDone: () => console.log('done') })
  .start('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 12, multipv: 2, timeMs: null });
```
Expected: console logs increasing depth, a finite White-POV eval near 0, and a first move like `e2e4`/`d2d4`, then `done`.

- [ ] **Step 4: Run the full frontend test suite (no regressions)**

Run: `cd frontend && npm run test`
Expected: all pre-existing suites still pass; new engine suites pass; the smoke test passes or skips.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/tests/engineLoad.smoke.test.ts && git commit -m "test(engine): real stockfish.wasm smoke test (depth-limited start position)"
```

---

## Self-Review

**Spec coverage (§5 of the design spec):**
- "Ship stockfish.wasm in a Web Worker; UCI parsed in TS" → Tasks 2/3 (parse), Task 6 (`WorkerEngine`). ✓
- "Feature-detect crossOriginIsolated && SharedArrayBuffer → threaded else single-thread" → `threadsAvailable()` + `loadStockfish()` (Task 6); COOP/COEP dev headers (Task 6 Step 4). ✓
- "Two presets map to wasm threads/hash; movetime/depth/multipv behave as today" → `configure()` (Threads/Hash) + `goLimitString` (depth/movetime) + `setoption MultiPV` (Task 5). Preset *selection* is Phase 1b; the mechanism exists here. ✓
- "wasm weaker, configurable" → depth/movetime honored via `goLimitString`. ✓
- White-POV eval semantics (eval bar/lines parity) → `toWhitePov`/`buildAnalysisInfo` (Tasks 1/3). ✓
- Streaming with cancel-on-new-position + natural-completion done (orchestrator's `_on_search_done`) → `AnalysisSession` (Task 5). ✓

**Placeholder scan:** the only non-literal value is the version-pinned dist filename, which is **discovered** by `copy-engine.mjs` (classified by pattern) and surfaced via `engine-manifest.json` — no hardcoded version, no TODO. `buildAnalysisInfo` ships as a throwing stub in Task 2 *by design* (TDD: implemented in Task 3, where the failing test drives it). ✓

**Type consistency:** `Eval`/`Line`/`AnalysisInfo` (types.ts) are consumed unchanged by `uci.ts`, `session.ts`, and the smoke test. `ParsedInfo`/`GoLimit` defined in `uci.ts` are imported by `session.ts`. `UciEngine` (engine.ts) is implemented by `WorkerEngine` and the test `FakeEngine`, and consumed by `AnalysisSession`. `StartOptions.timeMs` (ms) is converted to UCI `movetime <ms>` by `goLimitString` — note the Python orchestrator stores movetime in **seconds**; Phase 1b must pass `timeMs = movetimeSeconds * 1000` when calling `start()`. ✓

**Phase boundary:** no UI/WebSocket changes here; the module stands alone and is proven by the smoke test. Phase 1b consumes `AnalysisSession` + `loadStockfish` to replace the Python `Orchestrator`/WebSocket. ✓
```
