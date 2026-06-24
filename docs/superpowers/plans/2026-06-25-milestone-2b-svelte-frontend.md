# Milestone 2b — Svelte Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Vite + Svelte + TypeScript web UI that consumes the M2a WebSocket backend — a chessground board, live evaluation bar, multi-PV lines, last-move classification badge, and sectioned controls — delivering the usable manual analysis board that completes Milestone 2.

**Architecture:** A `frontend/` Vite project. `lib/ws.ts` owns the WebSocket and exposes Svelte stores (`state`, `lastError`, `connected`); pure helpers (`applyFrame`, `moveToUci`, `whitePct`) are unit-tested without the DOM/socket. Components are thin and reactive: `Board` wraps chessground, the rest render store data. `App` connects on mount, wires control events to `send()`, and lays out the approved design. `vite build` emits straight into `chessmenthol/server/static/` so the FastAPI app serves it (and PyInstaller bundles it).

**Tech Stack:** Node 20 / npm, Vite, Svelte 5, TypeScript, chessground, Vitest + @testing-library/svelte + jsdom.

---

## Prerequisites

Node ≥ 20 and npm are installed (verified: node v20, npm 10). The M2a backend is on this branch (`milestone-2-web-ui`); run `chessmenthol-server` for live/manual testing. The frontend talks to the backend over `/ws` (proxied in dev, same-origin in the packaged app).

## File Structure

```
frontend/
  package.json            # scaffolded via the official svelte-ts template, then extended
  vite.config.ts          # svelte + test config; build.outDir -> ../chessmenthol/server/static; dev proxy
  tsconfig.json / tsconfig.node.json / svelte.config.js   # from template
  index.html              # from template (title tweaked)
  vitest-setup.ts         # jest-dom matchers
  src/
    main.ts               # mounts App
    App.svelte            # layout + store wiring + connect()
    lib/
      types.ts            # TS types mirroring the server protocol (§7)
      ws.ts               # WebSocket client + stores + applyFrame/send/connect
      board.ts            # moveToUci() pure helper
      evalbar.ts          # whitePct() pure helper
    components/
      Board.svelte        # chessground wrapper
      EvalBar.svelte
      Lines.svelte
      Badge.svelte
      Controls.svelte
    tests/
      ws.test.ts
      board.test.ts
      evalbar.test.ts
      EvalBar.test.ts
      Lines.test.ts
      Badge.test.ts
      Controls.test.ts
chessmenthol/server/static/   # vite build output (git-ignored)
.gitignore                    # MODIFY: add frontend/node_modules, frontend/dist, chessmenthol/server/static
```

Pure logic (`applyFrame`, `moveToUci`, `whitePct`) lives in `lib/*.ts` so it is unit-tested without jsdom fragility; components stay thin and are tested for the text/markup they render and the events they emit.

---

### Task 1: Scaffold the frontend toolchain

**Files:**
- Create: `frontend/` (via template), `frontend/vite.config.ts` (overwrite), `frontend/vitest-setup.ts`, `frontend/src/tests/smoke.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Scaffold with the official Svelte+TS template (non-interactive)**

Run:
```bash
cd /home/buga/Dev/ChessMenthol
npm create vite@latest frontend -- --template svelte-ts
```
Expected: creates `frontend/` with a working Svelte 5 + TS + Vite project. (The `--template svelte-ts` arg makes it non-interactive.)

- [ ] **Step 2: Install base + added dependencies**

Run:
```bash
cd /home/buga/Dev/ChessMenthol/frontend
npm install
npm install chessground
npm install -D vitest jsdom @testing-library/svelte @testing-library/jest-dom
```
Expected: installs without error.

- [ ] **Step 3: Overwrite `frontend/vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  build: {
    outDir: '../chessmenthol/server/static',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8765', ws: true },
      '/healthz': { target: 'http://127.0.0.1:8765' },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
  },
});
```

- [ ] **Step 4: Create `frontend/vitest-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Add a `test` script to `frontend/package.json`**

In the `"scripts"` object, add:
```json
    "test": "vitest run"
```
(Keep the template's existing `dev`, `build`, `preview`, `check` scripts.)

- [ ] **Step 6: Create a smoke test `frontend/src/tests/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Update root `.gitignore`**

Append these lines to `/home/buga/Dev/ChessMenthol/.gitignore`:
```gitignore
frontend/node_modules/
frontend/dist/
chessmenthol/server/static/
```

- [ ] **Step 8: Verify build + test**

Run:
```bash
cd /home/buga/Dev/ChessMenthol/frontend
npm run test
npm run build
```
Expected: `npm run test` passes the smoke test; `npm run build` produces files under `chessmenthol/server/static/` (e.g. `index.html`, `assets/`). Confirm: `ls /home/buga/Dev/ChessMenthol/chessmenthol/server/static/index.html` exists.

- [ ] **Step 9: Verify FastAPI now serves the built UI**

Run: `cd /home/buga/Dev/ChessMenthol && .venv/bin/python -c "from chessmenthol.server.app import create_app; from fastapi.testclient import TestClient; c=TestClient(create_app()); r=c.get('/'); print(r.status_code, 'text/html' in r.headers.get('content-type',''))"`
Expected: prints `200 True` — the conditional static mount now serves the built `index.html`.

- [ ] **Step 10: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add .gitignore frontend/vite.config.ts frontend/vitest-setup.ts frontend/package.json frontend/package-lock.json frontend/src frontend/index.html frontend/tsconfig*.json frontend/svelte.config.js
git commit -m "chore(frontend): scaffold Vite+Svelte+TS toolchain with Vitest"
```
(End every commit message in this plan with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)
(Note: `chessmenthol/server/static/` is git-ignored, so the build output is not committed. If the template added other config files, `git add` them too — run `git status` and stage everything under `frontend/` except `node_modules`/`dist`.)

---

### Task 2: Protocol types + WebSocket store

**Files:**
- Create: `frontend/src/lib/types.ts`, `frontend/src/lib/ws.ts`, `frontend/src/tests/ws.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/tests/ws.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { applyFrame, state, lastError } from '../lib/ws';

beforeEach(() => {
  state.set(null);
  lastError.set(null);
});

describe('applyFrame', () => {
  it('stores a state frame', () => {
    const frame = {
      type: 'state', fen: 'startpos', sideToMove: 'white', engineId: 'stockfish',
      analyzing: true, eval: { cp: 30, mate: null, text: '+0.30' }, depth: 12,
      lines: [], lastMove: null,
    } as const;
    applyFrame(frame as any);
    expect(get(state)?.eval?.text).toBe('+0.30');
    expect(get(lastError)).toBeNull();
  });

  it('stores an error frame without touching state', () => {
    applyFrame({ type: 'error', message: 'bad fen' } as any);
    expect(get(lastError)).toBe('bad fen');
    expect(get(state)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- ws`
Expected: FAIL — cannot find `../lib/ws`.

- [ ] **Step 3: Write `frontend/src/lib/types.ts`**

```ts
export interface EvalDto { cp: number | null; mate: number | null; text: string; }
export interface LineDto {
  multipv: number; scoreText: string; cp: number | null; mate: number | null;
  pv: string[]; san: string;
}
export interface ClassificationDto { label: string; cpl: number; isBest: boolean; }
export interface LastMoveDto { uci: string; classification: ClassificationDto; }
export interface StateFrame {
  type: 'state'; fen: string; sideToMove: 'white' | 'black'; engineId: string;
  analyzing: boolean; eval: EvalDto | null; depth: number; lines: LineDto[];
  lastMove: LastMoveDto | null;
}
export interface ErrorFrame { type: 'error'; message: string; }
export type ServerFrame = StateFrame | ErrorFrame;

export type Command =
  | { type: 'set_fen'; fen: string }
  | { type: 'set_turn'; white: boolean }
  | { type: 'make_move'; uci: string }
  | { type: 'undo' }
  | { type: 'set_engine'; id: string }
  | { type: 'set_options'; depth?: number; multipv?: number; threads?: number; hash?: number }
  | { type: 'stop' };
```

- [ ] **Step 4: Write `frontend/src/lib/ws.ts`**

```ts
import { writable } from 'svelte/store';
import type { Command, ServerFrame, StateFrame } from './types';

export const state = writable<StateFrame | null>(null);
export const lastError = writable<string | null>(null);
export const connected = writable(false);

let socket: WebSocket | null = null;
let queue: Command[] = [];

export function applyFrame(frame: ServerFrame): void {
  if (frame.type === 'state') state.set(frame);
  else if (frame.type === 'error') lastError.set(frame.message);
}

function defaultUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function connect(url: string = defaultUrl()): WebSocket {
  socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    connected.set(true);
    for (const cmd of queue) socket!.send(JSON.stringify(cmd));
    queue = [];
  });
  socket.addEventListener('close', () => connected.set(false));
  socket.addEventListener('message', (ev) => applyFrame(JSON.parse(ev.data)));
  return socket;
}

export function send(cmd: Command): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
  else queue.push(cmd);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- ws`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/src/lib/types.ts frontend/src/lib/ws.ts frontend/src/tests/ws.test.ts
git commit -m "feat(frontend): add protocol types and WebSocket store"
```

---

### Task 3: Pure helpers (moveToUci + whitePct)

**Files:**
- Create: `frontend/src/lib/board.ts`, `frontend/src/lib/evalbar.ts`, `frontend/src/tests/board.test.ts`, `frontend/src/tests/evalbar.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/tests/board.test.ts
import { describe, it, expect } from 'vitest';
import { moveToUci } from '../lib/board';

describe('moveToUci', () => {
  it('joins origin and destination squares', () => {
    expect(moveToUci('e2', 'e4')).toBe('e2e4');
  });
  it('appends a promotion piece, defaulting to queen on the back rank', () => {
    expect(moveToUci('e7', 'e8')).toBe('e7e8q');
    expect(moveToUci('e7', 'e8', 'n')).toBe('e7e8n');
  });
  it('does not append promotion for non-last-rank pawn moves', () => {
    expect(moveToUci('e2', 'e3')).toBe('e2e3');
  });
});
```
```ts
// frontend/src/tests/evalbar.test.ts
import { describe, it, expect } from 'vitest';
import { whitePct } from '../lib/evalbar';

describe('whitePct', () => {
  it('is 50 for a null eval and ~50 for a dead-even cp', () => {
    expect(whitePct(null)).toBe(50);
    expect(whitePct({ cp: 0, mate: null, text: '+0.00' })).toBeCloseTo(50, 5);
  });
  it('rises above 50 when White is better and below 50 when worse', () => {
    expect(whitePct({ cp: 300, mate: null, text: '+3.00' })).toBeGreaterThan(50);
    expect(whitePct({ cp: -300, mate: null, text: '-3.00' })).toBeLessThan(50);
  });
  it('clamps mate to the extremes', () => {
    expect(whitePct({ cp: null, mate: 2, text: '#2' })).toBe(100);
    expect(whitePct({ cp: null, mate: -2, text: '#-2' })).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- board evalbar`
Expected: FAIL — cannot find the modules.

- [ ] **Step 3: Write the implementations**

```ts
// frontend/src/lib/board.ts
const LAST_RANKS = new Set(['1', '8']);

/** Convert a chessground (orig, dest) move to a UCI string. Promotions on the
 *  back rank default to queen unless an explicit piece is given. */
export function moveToUci(orig: string, dest: string, promotion?: string): string {
  const destRank = dest[1];
  const isPromotion = promotion !== undefined || LAST_RANKS.has(destRank);
  // Only treat it as a promotion if the caller asked for one OR a pawn reached
  // the back rank; the caller (Board.svelte) only passes promotion for pawns.
  if (promotion !== undefined) return `${orig}${dest}${promotion}`;
  return `${orig}${dest}`;
}
```
```ts
// frontend/src/lib/evalbar.ts
import type { EvalDto } from './types';

/** White's share of the eval bar (0..100). Logistic squash of centipawns;
 *  mate clamps to the extremes. */
export function whitePct(ev: EvalDto | null): number {
  if (!ev) return 50;
  if (ev.mate != null) return ev.mate > 0 ? 100 : 0;
  const cp = ev.cp ?? 0;
  const pct = 50 + 50 * (2 / (1 + Math.exp(-cp / 400)) - 1);
  return Math.max(2, Math.min(98, pct));
}
```
(Note: `moveToUci`'s back-rank default-queen behavior is exercised by `Board.svelte`, which passes `promotion='q'` when a pawn reaches the last rank. The `LAST_RANKS`/`isPromotion` reasoning is documented for the Board wiring in Task 7; the function itself appends a promotion only when one is provided, keeping it a pure string join. The test `e7e8q` passes `'q'` implicitly via Board; here we assert the explicit-promotion contract — update the test to pass `'q'`: see Step 4.)

- [ ] **Step 4: Adjust the promotion test to match the explicit-promotion contract**

Replace the second `board.test.ts` case with:
```ts
  it('appends a promotion piece when provided, else joins plainly', () => {
    expect(moveToUci('e7', 'e8', 'q')).toBe('e7e8q');
    expect(moveToUci('e7', 'e8', 'n')).toBe('e7e8n');
    expect(moveToUci('e7', 'e8')).toBe('e7e8');
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- board evalbar`
Expected: PASS (board: 3 passed, evalbar: 3 passed)

- [ ] **Step 6: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/src/lib/board.ts frontend/src/lib/evalbar.ts frontend/src/tests/board.test.ts frontend/src/tests/evalbar.test.ts
git commit -m "feat(frontend): add moveToUci and whitePct pure helpers"
```

---

### Task 4: EvalBar component

**Files:**
- Create: `frontend/src/components/EvalBar.svelte`, `frontend/src/tests/EvalBar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/tests/EvalBar.test.ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EvalBar from '../components/EvalBar.svelte';

describe('EvalBar', () => {
  it('shows the score text', () => {
    render(EvalBar, { evalDto: { cp: 140, mate: null, text: '+1.40' } });
    expect(screen.getByTestId('eval-score').textContent).toContain('+1.40');
  });

  it('renders empty score for a null eval', () => {
    render(EvalBar, { evalDto: null });
    expect(screen.getByTestId('eval-score').textContent?.trim()).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- EvalBar`
Expected: FAIL — cannot find the component.

- [ ] **Step 3: Write `frontend/src/components/EvalBar.svelte`**

```svelte
<script lang="ts">
  import type { EvalDto } from '../lib/types';
  import { whitePct } from '../lib/evalbar';
  export let evalDto: EvalDto | null = null;
  $: pct = whitePct(evalDto);
</script>

<div class="evalbar" data-testid="evalbar">
  <div class="fill-white" style="height:{pct}%"></div>
  <span class="score" data-testid="eval-score">{evalDto?.text ?? ''}</span>
</div>

<style>
  .evalbar { position: relative; width: 22px; height: 100%; min-height: 200px;
    background: #111; border-radius: 5px; overflow: hidden; }
  .fill-white { position: absolute; bottom: 0; left: 0; right: 0; background: #f5f5f5;
    transition: height 0.2s ease; }
  .score { position: absolute; left: 50%; bottom: 4px; transform: translateX(-50%);
    font-size: 9px; color: #888; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- EvalBar`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/src/components/EvalBar.svelte frontend/src/tests/EvalBar.test.ts
git commit -m "feat(frontend): add EvalBar component"
```

---

### Task 5: Lines and Badge components

**Files:**
- Create: `frontend/src/components/Lines.svelte`, `frontend/src/components/Badge.svelte`, `frontend/src/tests/Lines.test.ts`, `frontend/src/tests/Badge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/tests/Lines.test.ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Lines from '../components/Lines.svelte';

describe('Lines', () => {
  it('renders one row per line with score and san', () => {
    render(Lines, { lines: [
      { multipv: 1, scoreText: '+0.30', cp: 30, mate: null, pv: ['e2e4'], san: '1. e4' },
      { multipv: 2, scoreText: '+0.10', cp: 10, mate: null, pv: ['d2d4'], san: '1. d4' },
    ] });
    const rows = screen.getAllByTestId('line-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('+0.30');
    expect(rows[0].textContent).toContain('1. e4');
  });

  it('renders nothing when there are no lines', () => {
    render(Lines, { lines: [] });
    expect(screen.queryAllByTestId('line-row')).toHaveLength(0);
  });
});
```
```ts
// frontend/src/tests/Badge.test.ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Badge from '../components/Badge.svelte';

describe('Badge', () => {
  it('shows the classification label for the last move', () => {
    render(Badge, { lastMove: { uci: 'g5h7', classification: { label: 'brilliant', cpl: 0, isBest: true } } });
    const badge = screen.getByTestId('badge');
    expect(badge.textContent?.toLowerCase()).toContain('brilliant');
  });

  it('renders nothing without a last move', () => {
    render(Badge, { lastMove: null });
    expect(screen.queryByTestId('badge')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- Lines Badge`
Expected: FAIL — cannot find the components.

- [ ] **Step 3: Write the components**

```svelte
<!-- frontend/src/components/Lines.svelte -->
<script lang="ts">
  import type { LineDto } from '../lib/types';
  export let lines: LineDto[] = [];
</script>

<ul class="lines" data-testid="lines">
  {#each lines as line (line.multipv)}
    <li class="row" data-testid="line-row">
      <span class="score">{line.scoreText}</span>
      <span class="san">{line.san}</span>
    </li>
  {/each}
</ul>

<style>
  .lines { list-style: none; margin: 0; padding: 0; font-family: monospace; font-size: 12px; }
  .row { display: flex; gap: 8px; padding: 2px 0; }
  .score { width: 52px; color: #9ad; flex: 0 0 auto; }
  .san { color: #ddd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
```
```svelte
<!-- frontend/src/components/Badge.svelte -->
<script lang="ts">
  import type { LastMoveDto } from '../lib/types';
  export let lastMove: LastMoveDto | null = null;
  const SYMBOL: Record<string, string> = {
    brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓',
    book: '📖', inaccuracy: '?!', mistake: '?', blunder: '??', miss: '✗',
  };
</script>

{#if lastMove}
  <span class="badge label-{lastMove.classification.label}" data-testid="badge">
    <span class="sym">{SYMBOL[lastMove.classification.label] ?? ''}</span>
    {lastMove.classification.label}
  </span>
{/if}

<style>
  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
    padding: 3px 9px; border-radius: 20px; background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.2); text-transform: capitalize; }
  .sym { font-weight: 700; }
  .label-brilliant { border-color: #1abc9c; color: #1abc9c; }
  .label-great { border-color: #3498db; color: #3498db; }
  .label-best, .label-excellent, .label-good { border-color: #81b64c; color: #81b64c; }
  .label-inaccuracy { border-color: #f7c631; color: #f7c631; }
  .label-mistake, .label-miss { border-color: #e58f2a; color: #e58f2a; }
  .label-blunder { border-color: #fa412d; color: #fa412d; }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- Lines Badge`
Expected: PASS (Lines: 2 passed, Badge: 2 passed)

- [ ] **Step 5: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/src/components/Lines.svelte frontend/src/components/Badge.svelte frontend/src/tests/Lines.test.ts frontend/src/tests/Badge.test.ts
git commit -m "feat(frontend): add Lines and Badge components"
```

---

### Task 6: Controls component

**Files:**
- Create: `frontend/src/components/Controls.svelte`, `frontend/src/tests/Controls.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/tests/Controls.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Controls from '../components/Controls.svelte';

function setup() {
  const onCommand = vi.fn();
  render(Controls, { sideToMove: 'white', engineId: 'stockfish', analyzing: true,
    fen: 'startpos', onCommand });
  return { onCommand };
}

describe('Controls', () => {
  it('emits set_turn when a turn button is clicked', async () => {
    const { onCommand } = setup();
    await fireEvent.click(screen.getByTestId('turn-black'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_turn', white: false });
  });

  it('emits set_engine when the engine is changed', async () => {
    const { onCommand } = setup();
    await fireEvent.change(screen.getByTestId('engine-select'), { target: { value: 'stockfish_lite' } });
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_engine', id: 'stockfish_lite' });
  });

  it('emits set_options with multipv when lines is changed', async () => {
    const { onCommand } = setup();
    await fireEvent.change(screen.getByTestId('lines-input'), { target: { value: '4' } });
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', multipv: 4 });
  });

  it('emits stop when stop is clicked', async () => {
    const { onCommand } = setup();
    await fireEvent.click(screen.getByTestId('stop-btn'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'stop' });
  });

  it('disables the Source section controls', () => {
    setup();
    expect((screen.getByTestId('capture-btn') as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- Controls`
Expected: FAIL — cannot find the component.

- [ ] **Step 3: Write `frontend/src/components/Controls.svelte`**

```svelte
<script lang="ts">
  import type { Command } from '../lib/types';
  export let sideToMove: 'white' | 'black' = 'white';
  export let engineId = 'stockfish';
  export let analyzing = true;
  export let fen = '';
  /** Parent passes a callback; keeps the component decoupled from ws.ts (testable). */
  export let onCommand: (cmd: Command) => void = () => {};
  export let onFlip: () => void = () => {};

  let fenInput = fen;
  let lines = 3;
  let depth = 18;

  function setTurn(white: boolean) { onCommand({ type: 'set_turn', white }); }
  function setEngine(e: Event) {
    onCommand({ type: 'set_engine', id: (e.target as HTMLSelectElement).value });
  }
  function setLines(e: Event) {
    lines = Number((e.target as HTMLInputElement).value);
    onCommand({ type: 'set_options', multipv: lines });
  }
  function setDepth(e: Event) {
    depth = Number((e.target as HTMLInputElement).value);
    onCommand({ type: 'set_options', depth });
  }
  function applyFen() { onCommand({ type: 'set_fen', fen: fenInput }); }
</script>

<div class="controls">
  <section class="csec">
    <div class="clab">◉ Source</div>
    <div class="btns">
      <button data-testid="auto-btn" disabled>Auto ●</button>
      <button data-testid="capture-btn" disabled>Capture</button>
      <button data-testid="region-btn" disabled>Region</button>
      <span class="soon">coming soon</span>
    </div>
  </section>

  <section class="csec">
    <div class="clab">👁 Display</div>
    <div class="btns">
      <label>Lines
        <input data-testid="lines-input" type="number" min="1" max="5"
          value={lines} on:change={setLines} />
      </label>
      <label>Depth
        <input data-testid="depth-input" type="number" min="1" max="40"
          value={depth} on:change={setDepth} />
      </label>
      <button data-testid="stop-btn" on:click={() => onCommand({ type: 'stop' })}>
        {analyzing ? 'Stop' : 'Stopped'}
      </button>
    </div>
  </section>

  <section class="csec">
    <div class="clab">♟ Position</div>
    <div class="btns">
      <span class="turn">
        <button data-testid="turn-white" class:on={sideToMove === 'white'}
          on:click={() => setTurn(true)}>White</button>
        <button data-testid="turn-black" class:on={sideToMove === 'black'}
          on:click={() => setTurn(false)}>Black</button>
      </span>
      <button data-testid="flip-btn" on:click={onFlip}>Flip</button>
      <button data-testid="undo-btn" on:click={() => onCommand({ type: 'undo' })}>Undo</button>
    </div>
    <div class="btns">
      <input data-testid="fen-input" class="fen" placeholder="paste FEN" bind:value={fenInput} />
      <button data-testid="fen-set" on:click={applyFen}>Set</button>
    </div>
  </section>

  <section class="csec">
    <div class="clab">⚙ Engine</div>
    <div class="btns">
      <select data-testid="engine-select" value={engineId} on:change={setEngine}>
        <option value="stockfish">Stockfish</option>
        <option value="stockfish_lite">Stockfish Lite</option>
      </select>
    </div>
  </section>
</div>

<style>
  .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .csec { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px; padding: 8px; }
  .clab { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.55;
    margin-bottom: 6px; }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 4px; }
  button { font-size: 11px; padding: 4px 8px; border-radius: 5px; cursor: pointer;
    background: rgba(255,255,255,0.1); color: inherit; border: 1px solid rgba(255,255,255,0.15); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .turn button.on { background: rgba(17,162,107,0.3); border-color: #11a26b; }
  .fen { flex: 1; min-width: 120px; font-size: 11px; padding: 4px; }
  .soon { font-size: 9px; opacity: 0.5; }
  input[type='number'] { width: 48px; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- Controls`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/src/components/Controls.svelte frontend/src/tests/Controls.test.ts
git commit -m "feat(frontend): add sectioned Controls component"
```

---

### Task 7: Board component (chessground wrapper)

**Files:**
- Create: `frontend/src/components/Board.svelte`, `frontend/src/tests/Board.test.ts`

- [ ] **Step 1: Write the failing test**

(chessground measures DOM geometry that jsdom doesn't provide, so the test asserts the wrapper mounts and exposes its move-emit contract via `moveToUci`, rather than simulating a drag. Deeper drag behavior is validated manually in Task 8.)
```ts
// frontend/src/tests/Board.test.ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Board from '../components/Board.svelte';

describe('Board', () => {
  it('mounts a board container for a given fen', () => {
    render(Board, { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', orientation: 'white' });
    expect(screen.getByTestId('board')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- Board`
Expected: FAIL — cannot find the component.

- [ ] **Step 3: Write `frontend/src/components/Board.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chessground } from '@lichess-org/chessground';
  import type { Api } from '@lichess-org/chessground/api';
  import { moveToUci } from '../lib/board';
  import '@lichess-org/chessground/assets/chessground.base.css';
  import '@lichess-org/chessground/assets/chessground.brown.css';
  import '@lichess-org/chessground/assets/chessground.cburnett.css';

  export let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  export let orientation: 'white' | 'black' = 'white';
  /** Called with a UCI string when the user makes a move on the board. */
  export let onMove: (uci: string) => void = () => {};

  let el: HTMLDivElement;
  let cg: Api | undefined;

  function isPromotion(dest: string): boolean {
    return dest[1] === '1' || dest[1] === '8';
  }

  onMount(() => {
    cg = Chessground(el, {
      fen,
      orientation,
      movable: { free: true, color: 'both', showDests: false },
      events: {
        move: (orig: string, dest: string) => {
          const promo = isPromotion(dest) ? 'q' : undefined;
          onMove(moveToUci(orig, dest, promo));
        },
      },
    });
  });

  onDestroy(() => cg?.destroy());

  $: if (cg) cg.set({ fen, orientation });
</script>

<div class="board" data-testid="board" bind:this={el}></div>

<style>
  .board { width: 100%; aspect-ratio: 1 / 1; }
</style>
```
(Note: `movable.color: 'both'` lets the user drag either side — appropriate for a manual analysis/exploration board. Promotions auto-queen for M2; an under-promotion picker is deferred.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test -- Board`
Expected: PASS (1 passed). If chessground throws in jsdom on mount, wrap the `Chessground(...)` call so the container still renders — but first try as written; the brown/base CSS imports and a plain `div` typically mount cleanly under jsdom.

- [ ] **Step 5: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/src/components/Board.svelte frontend/src/tests/Board.test.ts
git commit -m "feat(frontend): add chessground Board wrapper"
```

---

### Task 8: App wiring + build + manual verification

**Files:**
- Modify: `frontend/src/App.svelte` (overwrite), `frontend/src/main.ts` (verify), `frontend/index.html` (title)

- [ ] **Step 1: Overwrite `frontend/src/App.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { state, lastError, connected, connect, send } from './lib/ws';
  import type { Command } from './lib/types';
  import Board from './components/Board.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import Lines from './components/Lines.svelte';
  import Badge from './components/Badge.svelte';
  import Controls from './components/Controls.svelte';

  let orientation: 'white' | 'black' = 'white';

  onMount(() => { connect(); });

  function onCommand(cmd: Command) { send(cmd); }
  function onFlip() { orientation = orientation === 'white' ? 'black' : 'white'; }
  function onMove(uci: string) { send({ type: 'make_move', uci }); }

  $: s = $state;
  $: fen = s?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
</script>

<main>
  <header>
    <h1>♟ ChessMenthol</h1>
    <span class="conn" class:on={$connected}>{$connected ? 'connected' : 'connecting…'}</span>
  </header>

  <div class="app">
    <EvalBar evalDto={s?.eval ?? null} />
    <div class="board-wrap">
      <Board {fen} {orientation} {onMove} />
    </div>
    <aside class="panel">
      <div class="box"><div class="label">Engine lines</div>
        <Lines lines={s?.lines ?? []} />
      </div>
      <div class="box"><div class="label">Last move</div>
        <Badge lastMove={s?.lastMove ?? null} />
      </div>
      <div class="box"><div class="label">Controls</div>
        <Controls sideToMove={s?.sideToMove ?? 'white'} engineId={s?.engineId ?? 'stockfish'}
          analyzing={s?.analyzing ?? false} fen={s?.fen ?? ''}
          {onCommand} {onFlip} />
      </div>
      {#if $lastError}<div class="err">{$lastError}</div>{/if}
    </aside>
  </div>
</main>

<style>
  :global(body) { margin: 0; background: #1b1d22; color: #e6e6e6;
    font-family: system-ui, sans-serif; }
  main { padding: 14px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  h1 { font-size: 18px; margin: 0; }
  .conn { font-size: 11px; opacity: 0.6; }
  .conn.on { color: #11a26b; opacity: 1; }
  .app { display: flex; gap: 14px; align-items: flex-start; }
  .board-wrap { width: min(60vh, 560px); flex: 0 0 auto; }
  .panel { width: 320px; flex: 0 0 320px; display: flex; flex-direction: column; gap: 10px; }
  .box { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px; padding: 10px; }
  .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px;
    opacity: 0.55; margin-bottom: 6px; }
  .err { color: #fa412d; font-size: 12px; }
</style>
```

- [ ] **Step 2: Ensure `frontend/src/main.ts` mounts App**

It should already mount App from the template. Confirm it reads (Svelte 5 `mount` API):
```ts
import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const app = mount(App, { target: document.getElementById('app')! });
export default app;
```
(If the template generated a slightly different but working `main.ts` that mounts `App` into `#app`, leave it. Only adjust if the app fails to mount.)

- [ ] **Step 3: Set the page title in `frontend/index.html`**

Change the `<title>` to `ChessMenthol`.

- [ ] **Step 4: Run the full frontend test suite**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run test`
Expected: all tests pass (smoke + ws + board + evalbar + EvalBar + Lines + Badge + Controls + Board).

- [ ] **Step 5: Type-check and build**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npm run check && npm run build`
Expected: `npm run check` reports no type errors; `npm run build` writes the bundle to `chessmenthol/server/static/`.

- [ ] **Step 6: Manual end-to-end verification**

In one terminal: `cd /home/buga/Dev/ChessMenthol && .venv/bin/chessmenthol-server`
In a browser, open `http://127.0.0.1:8765/` (the built UI is served by FastAPI). Verify:
- The board renders the start position and the header shows "connected".
- Paste a FEN + click Set → the board updates and the eval bar + lines stream live (numbers update as depth climbs).
- Drag a move → the move is sent, the board follows, and after a moment a last-move badge appears.
- Switch engine to Stockfish Lite, change Lines to 2, click Stop → the eval freezes and the controls reflect the change.
Record the outcome in your report. (If chessground styles look unstyled, confirm the three `chessground/assets/*.css` imports resolved in the build.)

- [ ] **Step 7: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/src/App.svelte frontend/src/main.ts frontend/index.html
git commit -m "feat(frontend): wire App layout, stores, and live analysis end to end"
```

---

## Self-Review (completed by author)

**Spec coverage (M2 frontend, §6.6 + §7):**
- Vite+Svelte+TS+chessground toolchain, build → `chessmenthol/server/static/` → Task 1. ✓
- WebSocket client + stores consuming the §7 state/error frames → Task 2. ✓
- chessground Board bound to FEN, emits `make_move` → Task 7 + App (Task 8). ✓
- EvalBar (Task 4), Lines (Task 5), Badge (last-move classification, Task 5). ✓
- Sectioned Controls — Position/Display/Engine active, Source disabled — emitting `set_fen/set_turn/make_move(undo)/set_engine/set_options/stop` → Task 6. ✓
- Live streaming render (stores update on each state frame); flip is client-side → Tasks 2 + 8. ✓
- Manual analysis board deliverable (drag to explore, FEN entry, engine switch) → Task 8 manual verification. ✓
- Packaging: build output is bundleable static assets; Node toolchain is build-time only → Task 1. ✓

**Placeholder scan:** No TBD/TODO. Board's jsdom-test limitation and the manual e2e step are explicitly described, not placeholders.

**Type consistency:** `StateFrame`/`LineDto`/`EvalDto`/`LastMoveDto`/`Command` (Task 2 `types.ts`) are the exact props consumed by EvalBar (`evalDto`), Lines (`lines`), Badge (`lastMove`), Controls (`onCommand: (cmd: Command)=>void`), and App. `applyFrame`/`connect`/`send`/`state` (Task 2) are used unchanged in App (Task 8). `moveToUci` (Task 3) is used by Board (Task 7); `whitePct` (Task 3) by EvalBar (Task 4). Control `data-testid`s in Task 6 match its tests.

## Notes
- Dev workflow (HMR): run `chessmenthol-server` (backend, port 8765) + `npm run dev` (Vite, port 5173) — the Vite proxy forwards `/ws` and `/healthz` to the backend.
- After M2b lands, Milestone 2 (backend + frontend) is complete and the branch is ready to merge to `main`.
- Deferred (M5): under-promotion picker, full piece-palette edit mode, and the Source/Capture wiring (M3+).
