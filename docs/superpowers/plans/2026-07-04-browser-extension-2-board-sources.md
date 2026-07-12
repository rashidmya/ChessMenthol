# Browser Extension — Plan 2: Board Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed live positions into the extension's already-working Orchestrator + WASM engine from two board sources — DOM adapters for chess.com/lichess (exact FEN, live-updating) and a `captureVisibleTab` + reused-vision-worker path for any other page (on-demand).

**Architecture:** Both sources converge on one existing ingress — the Orchestrator's `set_fen` command (side-to-move baked into the FEN). DOM adapters (isolated-world content scripts) parse the host page's pieces into an 8×8 grid and reuse `@core`'s `assembleFromGrid` to produce a validated FEN, which is messaged to the side panel. The vision path injects an extension-specific `VisionTrackerLike` (a `TabCapturer` + the reused `VisionWorkerClient`) into the Orchestrator, which pulls a position on the `capture_now` command. No desktop `app/` code is modified — the extension only adds new platform glue behind the same seams Plan 1 used.

**Tech Stack:** WXT (MV3, Chrome + Firefox), Svelte 5 (legacy API), TypeScript, Vitest + jsdom, `@core` path alias → `../app/src`, `onnxruntime-web/wasm` (single-threaded), chessops (via `@core`).

---

## Context the implementer needs (reuse facts — verified against the code)

These are the exact seams this plan reuses. Do not re-derive them; do not modify `app/`.

**Position ingress (both sources use this):** `Orchestrator.handle({ type: 'set_fen', fen })` is the single FEN ingress. Side-to-move must be encoded in the FEN's 2nd field — `set_fen` does not take a separate turn. To get eval/lines you must also have analysis enabled: `handle({ type: 'set_analysis_enabled', enabled: true })`. Both are already reachable in the panel via `client.send(cmd)` (Plan 1's `createPanelClient` returns `{ state, lastError, send }`).

**FEN assembly (reused, pure):** `import { assembleFromGrid } from '@core/core/chess'`.
- Signature: `assembleFromGrid(grid: (string|null)[][], opts: { white: boolean }): { fen: string; placement: string; isLegal: boolean; status: string; pos: Chess|null }`.
- `grid` is **white-bottom framed**: `grid[row][col]` is the square with file `col` (a=0 … h=7) and rank `8 - row` (so `grid[0][0]`=a8, `grid[7][7]`=h1).
- Each non-empty cell is a 2-char code `[color][ROLE]`: color lowercase `'w'|'b'`, role **UPPERCASE** `'P'|'N'|'B'|'R'|'Q'|'K'`. Examples: `'wP'` white pawn, `'bK'` black king. **VERIFIED:** `pieceFromCode` does `ROLE_OF[code[1]]` where `ROLE_OF` is keyed by uppercase letters — a lowercase role char yields `undefined` and crashes `Board.set`. chess.com's piece classes are lowercase (`wp`), so an adapter MUST upper-case the role char when building the grid. The app's own tests (`src/tests/coreChess.test.ts`) use `'wP'`/`'bK'`.
- `opts.white` = `true` when it's White to move. `assembleFromGrid` **infers castling rights** from piece placement and validates legality; `isLegal:false` means don't use the FEN.

**Vision tracker seam (reused, structural):** the Orchestrator accepts `opts.tracker?: VisionTrackerLike` and PULLS from it on `capture_now`. The structural shape (from `@core/core/orchestrator`):
```ts
export interface VisionTrackerLike {
  detectPosition(): Promise<AssembledPosition | null>;
  grabFullDesktop(): Promise<RgbaImage>;
  setRegion(region: { left: number; top: number; width: number; height: number } | null): void;
  setSideOverride(white: boolean | null): void;
  setOrientationOverride(o: 'white_bottom' | 'black_bottom' | null): void;
  reset(): void;
}
```
`RgbaImage` (from `@core/lib/capture`): `{ data: Uint8ClampedArray; width: number; height: number }` (RGBA, length `w*h*4`). `cropImage(src, region)` and the `VisionWorkerClient` class are reusable from `@core` unchanged.

**Reusable vision worker client (reused):** `import { VisionWorkerClient } from '@core/vision/visionClient'`. Constructor: `new VisionWorkerClient(worker: Worker)`. Method `detectPosition(image: RgbaImage): Promise<AssembledPosition|null>` — **transfers `image.data.buffer`**, so every capture must hand out a freshly-allocated buffer. The `VisionTracker` class itself is NOT reused (its constructor is typed to the concrete Tauri `Capturer`, whose `private` field breaks structural compatibility) — we build our own tracker object.

**Vision worker protocol (must be reproduced by our worker):** client→worker `{ id, type:'detect', image }` (buffer transferred) plus fire-and-forget `{ type:'setSideOverride', white }`, `{ type:'setOrientationOverride', orientation }`, `{ type:'reset' }`; worker→client `{ id, ok:true, result }` or `{ id, ok:false, error }`.

**Existing panel wiring (Plan 1, do not break):** `extension/entrypoints/sidepanel/Panel.svelte` uses `createPanelClient(loadWasmEngine)`, stores `client.state` / `client.lastError`, `data-testid`s: `fen-input`, `load-fen`, `analyze`, `current-fen`, `panel-error`, and `Board` renders its own `data-testid="board"`. `wxt.config.ts` already sets COOP `same-origin` + COEP `require-corp`, CSP `script-src 'self' 'wasm-unsafe-eval'`, and `web_accessible_resources: [{ resources: ['engine/*'], matches: ['<all_urls>'] }]`, permissions `['storage']`, `@core` alias, `worker.format:'es'`. Test env: jsdom, `globals:true`, setup only registers jest-dom.

**All new files live under `extension/`. Run all commands from `extension/`.**

---

# PART A — DOM adapters (chess.com + lichess)

## Task 1: Adapter interface, position type, and registry

**Files:**
- Create: `extension/src/lib/adapters/types.ts`
- Create: `extension/src/lib/adapters/registry.ts`
- Test: `extension/src/lib/adapters/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// extension/src/lib/adapters/registry.test.ts
import { describe, it, expect } from 'vitest';
import { adapterFor } from './registry';
import type { SiteAdapter } from './types';

describe('adapterFor', () => {
  it('returns the chess.com adapter for chess.com URLs', () => {
    const a = adapterFor('https://www.chess.com/game/live/123');
    expect(a?.site).toBe('chesscom');
  });
  it('returns the lichess adapter for lichess.org URLs', () => {
    const a = adapterFor('https://lichess.org/abcd1234');
    expect(a?.site).toBe('lichess');
  });
  it('returns null for an unknown site', () => {
    expect(adapterFor('https://example.com/')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/adapters/registry.test.ts`
Expected: FAIL — cannot find `./registry` / `./types`.

- [ ] **Step 3: Write the interface + type**

```ts
// extension/src/lib/adapters/types.ts

/** A position read straight from a host page's DOM. FEN is fully assembled
 *  (side-to-move baked into the 2nd field), ready for the Orchestrator's set_fen. */
export interface AdapterPosition {
  fen: string;
  /** Which side is shown at the bottom of the host board — a display hint for the panel. */
  orientation: 'white' | 'black';
  /** Side to move; already reflected inside `fen`. */
  turn: 'w' | 'b';
}

/** One implementation per known site. The only site-specific code in the extension. */
export interface SiteAdapter {
  readonly site: 'chesscom' | 'lichess';
  /** True when this adapter can read `url`'s page. */
  matches(url: string): boolean;
  /** Parse the current DOM into a position, or null if no readable board / illegal parse. */
  readPosition(): AdapterPosition | null;
  /** Fire `onChange` on each settled board mutation; returns an unsubscribe fn. */
  observe(onChange: () => void): () => void;
}
```

- [ ] **Step 4: Write the registry (stub adapters wired in later tasks)**

```ts
// extension/src/lib/adapters/registry.ts
import type { SiteAdapter } from './types';
import { chesscomAdapter } from './chesscom';
import { lichessAdapter } from './lichess';

const ADAPTERS: SiteAdapter[] = [chesscomAdapter, lichessAdapter];

/** The first adapter whose `matches(url)` is true, or null. */
export function adapterFor(url: string): SiteAdapter | null {
  return ADAPTERS.find((a) => a.matches(url)) ?? null;
}
```

- [ ] **Step 5: Create minimal adapter stubs so the registry imports resolve**

```ts
// extension/src/lib/adapters/chesscom.ts
import type { SiteAdapter } from './types';
export const chesscomAdapter: SiteAdapter = {
  site: 'chesscom',
  matches: (url) => /(^|\.)chess\.com$/.test(hostOf(url)),
  readPosition: () => null,
  observe: () => () => {},
};
function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return ''; } }
```

```ts
// extension/src/lib/adapters/lichess.ts
import type { SiteAdapter } from './types';
export const lichessAdapter: SiteAdapter = {
  site: 'lichess',
  matches: (url) => /(^|\.)lichess\.org$/.test(hostOf(url)),
  readPosition: () => null,
  observe: () => () => {},
};
function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return ''; } }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/adapters/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add extension/src/lib/adapters
git commit -m "feat(ext): SiteAdapter interface + registry (chess.com/lichess routing)"
```

---

## Task 2: chess.com adapter — read the board to a FEN

**Files:**
- Modify: `extension/src/lib/adapters/chesscom.ts`
- Create: `extension/src/lib/adapters/__fixtures__/chesscom-startpos.html`
- Test: `extension/src/lib/adapters/chesscom.test.ts`

**Background:** chess.com renders `<wc-chess-board>` containing `<div class="piece wp square-52">` — `wp` = white pawn (already a `[color][role]` code), `square-52` = file 5 (e), rank 2 (absolute, White's view). Board flip adds `flipped` to the board element. Last-move squares are `<div class="highlight square-XX ...">`; the mover's piece sits on the destination highlight. **Step 1 verifies these selectors against a real board (save a live game's `document.querySelector('wc-chess-board').outerHTML`); adjust the fixture/selectors if chess.com changed them.**

- [ ] **Step 1: Create a DOM fixture (starting position, White to move after 1.e4 so turn is derivable)**

Represent Black-to-move after `1.e4`: pawn moved e2→e4, so the last-move highlights are e2 (empty) and e4 (white pawn) ⇒ White just moved ⇒ turn `b`.

```html
<!-- extension/src/lib/adapters/__fixtures__/chesscom-startpos.html -->
<wc-chess-board class="board">
  <div class="piece wr square-11"></div><div class="piece wn square-21"></div>
  <div class="piece wb square-31"></div><div class="piece wq square-41"></div>
  <div class="piece wk square-51"></div><div class="piece wb square-61"></div>
  <div class="piece wn square-71"></div><div class="piece wr square-81"></div>
  <div class="piece wp square-12"></div><div class="piece wp square-22"></div>
  <div class="piece wp square-32"></div><div class="piece wp square-42"></div>
  <div class="piece wp square-62"></div><div class="piece wp square-72"></div>
  <div class="piece wp square-82"></div>
  <div class="piece wp square-54"></div>
  <div class="piece bp square-17"></div><div class="piece bp square-27"></div>
  <div class="piece bp square-37"></div><div class="piece bp square-47"></div>
  <div class="piece bp square-57"></div><div class="piece bp square-67"></div>
  <div class="piece bp square-77"></div><div class="piece bp square-87"></div>
  <div class="piece br square-18"></div><div class="piece bn square-28"></div>
  <div class="piece bb square-38"></div><div class="piece bq square-48"></div>
  <div class="piece bk square-58"></div><div class="piece bb square-68"></div>
  <div class="piece bn square-78"></div><div class="piece br square-88"></div>
  <div class="highlight square-52"></div>
  <div class="highlight square-54"></div>
</wc-chess-board>
```

- [ ] **Step 2: Write the failing test**

```ts
// extension/src/lib/adapters/chesscom.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chesscomAdapter } from './chesscom';

const fixture = readFileSync(
  fileURLToPath(new URL('./__fixtures__/chesscom-startpos.html', import.meta.url)),
  'utf8',
);

describe('chesscomAdapter.readPosition', () => {
  beforeEach(() => { document.body.innerHTML = fixture; });

  it('reads the position after 1.e4 with Black to move', () => {
    const pos = chesscomAdapter.readPosition();
    expect(pos).not.toBeNull();
    // placement + turn; ignore castling/ep/clock fields for the assertion
    expect(pos!.fen.split(' ').slice(0, 2).join(' ')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b',
    );
    expect(pos!.turn).toBe('b');
    expect(pos!.orientation).toBe('white');
  });

  it('returns null when there is no board', () => {
    document.body.innerHTML = '<div>no board here</div>';
    expect(chesscomAdapter.readPosition()).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/adapters/chesscom.test.ts`
Expected: FAIL — `readPosition` returns `null` (stub).

- [ ] **Step 4: Implement `readPosition` (reuses `assembleFromGrid`)**

```ts
// extension/src/lib/adapters/chesscom.ts
import { assembleFromGrid } from '@core/core/chess';
import type { AdapterPosition, SiteAdapter } from './types';

const CODE_RE = /\b([wb][pnbrqk])\b/;      // e.g. 'wp', 'bk'
const SQ_RE = /\bsquare-(\d)(\d)\b/;        // file, rank (1..8, absolute White's view)

function boardEl(): Element | null {
  return document.querySelector('wc-chess-board, .board .pieces, .board');
}

/** Build the white-bottom grid assembleFromGrid expects from chess.com pieces. */
function readGrid(board: Element): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: 8 }, () =>
    Array<string | null>(8).fill(null),
  );
  for (const el of board.querySelectorAll('.piece')) {
    const cls = el.className;
    const code = cls.match(CODE_RE);
    const sq = cls.match(SQ_RE);
    if (!code || !sq) continue;
    const file = Number(sq[1]); // 1..8
    const rank = Number(sq[2]); // 1..8
    grid[8 - rank][file - 1] = code[1]; // white-bottom frame
  }
  return grid;
}

/** Side to move from the last-move highlight: the highlighted square that still
 *  holds a piece is the mover's destination ⇒ opposite side is to move. */
function readTurn(board: Element, grid: (string | null)[][]): 'w' | 'b' {
  for (const hl of board.querySelectorAll('.highlight')) {
    const sq = hl.className.match(SQ_RE);
    if (!sq) continue;
    const file = Number(sq[1]); const rank = Number(sq[2]);
    const code = grid[8 - rank][file - 1];
    if (code) return code[0] === 'w' ? 'b' : 'w';
  }
  return 'w';
}

export const chesscomAdapter: SiteAdapter = {
  site: 'chesscom',
  matches: (url) => /(^|\.)chess\.com$/.test(hostOf(url)),

  readPosition(): AdapterPosition | null {
    const board = boardEl();
    if (!board) return null;
    const grid = readGrid(board);
    const turn = readTurn(board, grid);
    const res = assembleFromGrid(grid, { white: turn === 'w' });
    if (!res.isLegal) return null;
    const orientation = board.classList.contains('flipped') ? 'black' : 'white';
    return { fen: res.fen, orientation, turn };
  },

  // Live observation is wired in Task 4 (observeBoard). No-op until then.
  observe: () => () => {},
};

function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return ''; } }
```

(`observe` stays a no-op in this task; Task 4 creates `observe.ts` and replaces this with the real `observeBoard` wiring, so there is no forward import dependency.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/adapters/chesscom.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add extension/src/lib/adapters/chesscom.ts extension/src/lib/adapters/chesscom.test.ts extension/src/lib/adapters/__fixtures__/chesscom-startpos.html
git commit -m "feat(ext): chess.com adapter reads board -> FEN via assembleFromGrid"
```

---

## Task 3: lichess adapter — read chessground to a FEN

**Files:**
- Modify: `extension/src/lib/adapters/lichess.ts`
- Create: `extension/src/lib/adapters/__fixtures__/lichess-startpos.html`
- Test: `extension/src/lib/adapters/lichess.test.ts`

**Background:** lichess renders chessground: `<cg-board>` containing `<piece class="white pawn" style="transform: translate(256px, 384px)">`. Square = `translate` ÷ squareSize, where `squareSize = boardWidth / 8` and `boardWidth = cgBoard.getBoundingClientRect().width`. With white orientation, translate `(0,0)` is a8 (top-left): `file = round(x / squareSize)`, `rankFromTop = round(y / squareSize)`, so the white-bottom grid cell is `grid[rankFromTop][file]`. When `.cg-wrap` has `orientation-black`, the board is 180°-rotated: `grid[7 - rankFromTop][7 - file]`. Last move: `<square class="last-move" style="transform: ...">`. **Step 1 verifies selectors against a real lichess board.**

- [ ] **Step 1: Create a DOM fixture (after 1.e4, Black to move; squareSize 64 ⇒ boardWidth 512)**

Pieces are placed by transform in a white-oriented board (translate origin a8 top-left). e4 = file 4 (e), rank 4 ⇒ x=4*64=256, rankFromTop=8-4=4 ⇒ y=4*64=256. Include only enough pieces to make the FEN unambiguous plus the last-move squares e2 (empty origin) and e4 (destination, occupied).

```html
<!-- extension/src/lib/adapters/__fixtures__/lichess-startpos.html -->
<div class="cg-wrap orientation-white">
  <cg-container>
    <cg-board>
      <!-- rank 8 (y=0) -->
      <piece class="black rook" style="transform: translate(0px, 0px);"></piece>
      <piece class="black knight" style="transform: translate(64px, 0px);"></piece>
      <piece class="black bishop" style="transform: translate(128px, 0px);"></piece>
      <piece class="black queen" style="transform: translate(192px, 0px);"></piece>
      <piece class="black king" style="transform: translate(256px, 0px);"></piece>
      <piece class="black bishop" style="transform: translate(320px, 0px);"></piece>
      <piece class="black knight" style="transform: translate(384px, 0px);"></piece>
      <piece class="black rook" style="transform: translate(448px, 0px);"></piece>
      <!-- rank 7 (y=64) black pawns -->
      <piece class="black pawn" style="transform: translate(0px, 64px);"></piece>
      <piece class="black pawn" style="transform: translate(64px, 64px);"></piece>
      <piece class="black pawn" style="transform: translate(128px, 64px);"></piece>
      <piece class="black pawn" style="transform: translate(192px, 64px);"></piece>
      <piece class="black pawn" style="transform: translate(256px, 64px);"></piece>
      <piece class="black pawn" style="transform: translate(320px, 64px);"></piece>
      <piece class="black pawn" style="transform: translate(384px, 64px);"></piece>
      <piece class="black pawn" style="transform: translate(448px, 64px);"></piece>
      <!-- e4 white pawn (x=256, y=256) -->
      <piece class="white pawn" style="transform: translate(256px, 256px);"></piece>
      <!-- rank 2 (y=384) white pawns, e-file missing -->
      <piece class="white pawn" style="transform: translate(0px, 384px);"></piece>
      <piece class="white pawn" style="transform: translate(64px, 384px);"></piece>
      <piece class="white pawn" style="transform: translate(128px, 384px);"></piece>
      <piece class="white pawn" style="transform: translate(192px, 384px);"></piece>
      <piece class="white pawn" style="transform: translate(320px, 384px);"></piece>
      <piece class="white pawn" style="transform: translate(384px, 384px);"></piece>
      <piece class="white pawn" style="transform: translate(448px, 384px);"></piece>
      <!-- rank 1 (y=448) -->
      <piece class="white rook" style="transform: translate(0px, 448px);"></piece>
      <piece class="white knight" style="transform: translate(64px, 448px);"></piece>
      <piece class="white bishop" style="transform: translate(128px, 448px);"></piece>
      <piece class="white queen" style="transform: translate(192px, 448px);"></piece>
      <piece class="white king" style="transform: translate(256px, 448px);"></piece>
      <piece class="white bishop" style="transform: translate(320px, 448px);"></piece>
      <piece class="white knight" style="transform: translate(384px, 448px);"></piece>
      <piece class="white rook" style="transform: translate(448px, 448px);"></piece>
      <!-- last move e2 (origin, y=384) and e4 (dest, y=256) -->
      <square class="last-move" style="transform: translate(256px, 384px);"></square>
      <square class="last-move" style="transform: translate(256px, 256px);"></square>
    </cg-board>
  </cg-container>
</div>
```

- [ ] **Step 2: Write the failing test (mock the board width, which jsdom cannot lay out)**

```ts
// extension/src/lib/adapters/lichess.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lichessAdapter } from './lichess';

// NOTE: vitest.config sets resolve.conditions ['browser'], which rewrites
// `new URL('./x', import.meta.url)` to an http URL and breaks fileURLToPath.
// Resolve the fixture dir once, then join — same pattern Task 2 used.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '__fixtures__', 'lichess-startpos.html'), 'utf8');

beforeEach(() => {
  document.body.innerHTML = fixture;
  // jsdom does no layout; give the board a real 512px width so squareSize = 64.
  const board = document.querySelector('cg-board')!;
  board.getBoundingClientRect = () => ({ width: 512, height: 512, top: 0, left: 0, right: 512, bottom: 512, x: 0, y: 0, toJSON() {} }) as DOMRect;
});

describe('lichessAdapter.readPosition', () => {
  it('reads the position after 1.e4 with Black to move', () => {
    const pos = lichessAdapter.readPosition();
    expect(pos).not.toBeNull();
    expect(pos!.fen.split(' ').slice(0, 2).join(' ')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b',
    );
    expect(pos!.turn).toBe('b');
    expect(pos!.orientation).toBe('white');
  });

  it('returns null with no board', () => {
    document.body.innerHTML = '<div>nothing</div>';
    expect(lichessAdapter.readPosition()).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/adapters/lichess.test.ts`
Expected: FAIL — stub returns null.

- [ ] **Step 4: Implement `readPosition`**

```ts
// extension/src/lib/adapters/lichess.ts
import { assembleFromGrid } from '@core/core/chess';
import type { AdapterPosition, SiteAdapter } from './types';

// UPPERCASE role letters — assembleFromGrid's ROLE_OF is keyed P/N/B/R/Q/K.
const ROLE_CHAR: Record<string, string> = {
  pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K',
};

function boardEl(): HTMLElement | null {
  return document.querySelector('cg-board');
}

function squareSize(board: Element): number {
  const w = board.getBoundingClientRect().width;
  return w > 0 ? w / 8 : 0;
}

/** Parse "transform: translate(Xpx, Ypx)" -> [x, y] in px, or null. */
function translateOf(el: Element): [number, number] | null {
  const t = (el as HTMLElement).style.transform;
  const m = t.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function isBlackOriented(): boolean {
  return !!document.querySelector('.cg-wrap.orientation-black, .orientation-black cg-board');
}

/** White-bottom grid coords for a piece/square at pixel (x,y). */
function cell(x: number, y: number, size: number, black: boolean): [number, number] {
  const file = Math.round(x / size);
  const rankFromTop = Math.round(y / size);
  return black ? [7 - rankFromTop, 7 - file] : [rankFromTop, file]; // [row, col]
}

export const lichessAdapter: SiteAdapter = {
  site: 'lichess',
  matches: (url) => /(^|\.)lichess\.org$/.test(hostOf(url)),

  readPosition(): AdapterPosition | null {
    const board = boardEl();
    if (!board) return null;
    const size = squareSize(board);
    if (!size) return null;
    const black = isBlackOriented();

    const grid: (string | null)[][] = Array.from({ length: 8 }, () =>
      Array<string | null>(8).fill(null),
    );
    for (const p of board.querySelectorAll('piece')) {
      const xy = translateOf(p);
      if (!xy) continue;
      const cls = p.className.split(/\s+/);
      const color = cls.includes('white') ? 'w' : cls.includes('black') ? 'b' : null;
      const roleWord = cls.find((c) => c in ROLE_CHAR);
      if (!color || !roleWord) continue;
      const [row, col] = cell(xy[0], xy[1], size, black);
      if (row < 0 || row > 7 || col < 0 || col > 7) continue;
      grid[row][col] = color + ROLE_CHAR[roleWord];
    }

    const turn = readTurn(board, grid, size, black);
    const res = assembleFromGrid(grid, { white: turn === 'w' });
    if (!res.isLegal) return null;
    return { fen: res.fen, orientation: black ? 'black' : 'white', turn };
  },

  // Live observation is wired in Task 4 (observeBoard). No-op until then.
  observe: () => () => {},
};

/** Last-move square that still holds a piece is the mover's destination. */
function readTurn(board: Element, grid: (string | null)[][], size: number, black: boolean): 'w' | 'b' {
  for (const sq of board.querySelectorAll('square.last-move')) {
    const xy = translateOf(sq);
    if (!xy) continue;
    const [row, col] = cell(xy[0], xy[1], size, black);
    const code = grid[row]?.[col];
    if (code) return code[0] === 'w' ? 'b' : 'w';
  }
  return 'w';
}

function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return ''; } }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/adapters/lichess.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add extension/src/lib/adapters/lichess.ts extension/src/lib/adapters/lichess.test.ts extension/src/lib/adapters/__fixtures__/lichess-startpos.html
git commit -m "feat(ext): lichess adapter reads chessground -> FEN via assembleFromGrid"
```

---

## Task 4: Debounced board observer

**Files:**
- Create: `extension/src/lib/adapters/observe.ts`
- Test: `extension/src/lib/adapters/observe.test.ts`

**Note:** if you did Task 4 before wiring `observe` in Tasks 2–3, remove any temporary `observeBoard` stubs there now.

- [ ] **Step 1: Write the failing test (fake timers; jsdom has MutationObserver)**

```ts
// extension/src/lib/adapters/observe.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { observeBoard } from './observe';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('observeBoard', () => {
  it('debounces a burst of mutations into one onChange', async () => {
    const board = document.createElement('div');
    document.body.appendChild(board);
    const onChange = vi.fn();
    const stop = observeBoard(board, onChange, 50);

    for (let i = 0; i < 5; i++) board.appendChild(document.createElement('span'));
    await Promise.resolve();               // let MutationObserver flush its microtask
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops firing after unsubscribe', async () => {
    const board = document.createElement('div');
    const onChange = vi.fn();
    const stop = observeBoard(board, onChange, 50);
    stop();
    board.appendChild(document.createElement('span'));
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/adapters/observe.test.ts`
Expected: FAIL — cannot find `./observe`.

- [ ] **Step 3: Implement**

```ts
// extension/src/lib/adapters/observe.ts

/** Watch a board subtree; coalesce mutation bursts into one debounced onChange.
 *  Returns an unsubscribe that disconnects the observer and cancels pending fires. */
export function observeBoard(board: Element, onChange: () => void, debounceMs = 120): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const mo = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; onChange(); }, debounceMs);
  });
  mo.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  return () => { if (timer) clearTimeout(timer); mo.disconnect(); };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/adapters/observe.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `observeBoard` into both adapters (replace the no-op `observe`)**

In `chesscom.ts`: add `import { observeBoard } from './observe';` and replace `observe: () => () => {},` with:
```ts
  observe(onChange) {
    const board = boardEl();
    if (!board) return () => {};
    return observeBoard(board, onChange);
  },
```

In `lichess.ts`: add `import { observeBoard } from './observe';` and replace `observe: () => () => {},` with:
```ts
  observe(onChange) {
    const board = boardEl();
    if (!board) return () => {};
    return observeBoard(board, onChange);
  },
```

Then re-run all adapter tests:
Run: `npx vitest run src/lib/adapters/`
Expected: PASS (all adapter + registry + observe tests).

- [ ] **Step 6: Commit**

```bash
git add extension/src/lib/adapters/observe.ts extension/src/lib/adapters/observe.test.ts extension/src/lib/adapters/chesscom.ts extension/src/lib/adapters/lichess.ts
git commit -m "feat(ext): debounced MutationObserver for live board updates"
```

---

# PART B — Wire the DOM path end-to-end (messaging → panel)

## Task 5: Typed message contract

**Files:**
- Create: `extension/src/lib/messages.ts`
- Test: `extension/src/lib/messages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// extension/src/lib/messages.test.ts
import { describe, it, expect } from 'vitest';
import { isPositionMessage, type ExtMessage } from './messages';

describe('message guards', () => {
  it('recognizes a position message', () => {
    const m: ExtMessage = { kind: 'position', fen: '8/8/8/8/8/8/8/8 w - - 0 1', orientation: 'white', turn: 'w', site: 'lichess' };
    expect(isPositionMessage(m)).toBe(true);
  });
  it('rejects other messages', () => {
    expect(isPositionMessage({ kind: 'capture-request' } as ExtMessage)).toBe(false);
    expect(isPositionMessage({} as ExtMessage)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/messages.test.ts`
Expected: FAIL — cannot find `./messages`.

- [ ] **Step 3: Implement**

```ts
// extension/src/lib/messages.ts
import type { AdapterPosition } from './adapters/types';

/** Content script -> panel: a freshly-read position. */
export interface PositionMessage extends AdapterPosition {
  kind: 'position';
  site: 'chesscom' | 'lichess';
}
/** Panel -> background: capture the visible tab for the vision path. */
export interface CaptureRequest { kind: 'capture-request' }
/** Background -> panel: the captured frame as a PNG data URL. */
export interface CaptureResult { kind: 'capture-result'; dataUrl: string | null; error?: string }

export type ExtMessage = PositionMessage | CaptureRequest | CaptureResult;

export function isPositionMessage(m: ExtMessage): m is PositionMessage {
  return !!m && (m as PositionMessage).kind === 'position' && typeof (m as PositionMessage).fen === 'string';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/messages.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/messages.ts extension/src/lib/messages.test.ts
git commit -m "feat(ext): typed content<->panel<->background message contract"
```

---

## Task 6: Content script — read + observe + broadcast position

**Files:**
- Create: `extension/entrypoints/content.ts`
- Create: `extension/src/lib/contentDriver.ts` (testable core, no `browser` global)
- Test: `extension/src/lib/contentDriver.test.ts`

**Rationale:** WXT entrypoints are hard to unit-test (they call `defineContentScript`/`browser`). Keep the logic in a pure `runContentDriver(adapter, send)` and let the entrypoint be a 3-line shim.

- [ ] **Step 1: Write the failing test**

```ts
// extension/src/lib/contentDriver.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runContentDriver } from './contentDriver';
import type { SiteAdapter } from './adapters/types';
import type { PositionMessage } from './messages';

// `fire(nextFen?)` simulates an observed board change to a NEW position.
// The driver dedupes identical FENs, so a meaningful "sends again" test must
// actually change the FEN between reads.
function fakeAdapter(initialFen: string): SiteAdapter & { fire: (nextFen?: string) => void } {
  let cb: () => void = () => {};
  let fen = initialFen;
  return {
    site: 'lichess',
    matches: () => true,
    readPosition: () => ({ fen, orientation: 'white', turn: 'w' }),
    observe: (onChange) => { cb = onChange; return () => {}; },
    fire: (nextFen = '8/8/8/8/8/8/8/8 b - - 0 1') => { fen = nextFen; cb(); },
  };
}

describe('runContentDriver', () => {
  it('sends the initial position and again on each observed change', () => {
    const sent: PositionMessage[] = [];
    const a = fakeAdapter('8/8/8/8/8/8/8/8 w - - 0 1');
    const stop = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'position', site: 'lichess', fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
    a.fire();
    expect(sent).toHaveLength(2);
    stop();
  });

  it('dedupes identical FENs and skips null reads', () => {
    const sent: PositionMessage[] = [];
    let fen: string | null = 'aaa';
    let cb: () => void = () => {};
    const a: SiteAdapter = {
      site: 'chesscom',
      matches: () => true,
      readPosition: () => (fen ? { fen, orientation: 'white', turn: 'w' } : null),
      observe: (onChange) => { cb = onChange; return () => {}; },
    };
    const stop = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);          // initial 'aaa'
    cb();                                  // same FEN -> deduped
    expect(sent).toHaveLength(1);
    fen = null; cb();                      // null read -> no send
    expect(sent).toHaveLength(1);
    fen = 'bbb'; cb();                     // changed -> sent
    expect(sent).toHaveLength(2);
    stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/contentDriver.test.ts`
Expected: FAIL — cannot find `./contentDriver`.

- [ ] **Step 3: Implement the driver**

```ts
// extension/src/lib/contentDriver.ts
import type { SiteAdapter } from './adapters/types';
import type { PositionMessage } from './messages';

/** Read once, then on every observed change; emit a PositionMessage per new FEN.
 *  Returns a stop() that tears down the observer. */
export function runContentDriver(adapter: SiteAdapter, send: (m: PositionMessage) => void): () => void {
  let lastFen: string | null = null;
  const emit = () => {
    const pos = adapter.readPosition();
    if (!pos || pos.fen === lastFen) return;
    lastFen = pos.fen;
    send({ kind: 'position', site: adapter.site, ...pos });
  };
  emit();
  return adapter.observe(emit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/contentDriver.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the WXT content-script entrypoint (shim; not unit-tested)**

```ts
// extension/entrypoints/content.ts
// `defineContentScript` and `browser` are WXT auto-imported globals (as in Plan 1's background.ts).
import { adapterFor } from '../src/lib/adapters/registry';
import { runContentDriver } from '../src/lib/contentDriver';
import type { PositionMessage } from '../src/lib/messages';

export default defineContentScript({
  matches: ['*://*.chess.com/*', '*://lichess.org/*'],
  main() {
    const adapter = adapterFor(location.href);
    if (!adapter) return;
    runContentDriver(adapter, (m: PositionMessage) => {
      browser.runtime.sendMessage(m).catch(() => {}); // panel may be closed
    });
  },
});
```

- [ ] **Step 6: Verify the whole extension still type-checks and builds**

Run: `npm run check`
Expected: 0 errors, 0 warnings.
Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add extension/src/lib/contentDriver.ts extension/src/lib/contentDriver.test.ts extension/entrypoints/content.ts
git commit -m "feat(ext): content script broadcasts live adapter positions"
```

---

## Task 7: Panel consumes positions → set_fen + auto-analyze

**Files:**
- Modify: `extension/src/lib/panelClient.ts` (add a pure `applyPosition` helper)
- Modify: `extension/entrypoints/sidepanel/Panel.svelte`
- Test: `extension/src/lib/panelClient.applyPosition.test.ts`

- [ ] **Step 1: Write the failing test for the pure helper**

```ts
// extension/src/lib/panelClient.applyPosition.test.ts
import { describe, it, expect, vi } from 'vitest';
import { applyPosition } from './panelClient';
import type { Command } from '@core/lib/types';

describe('applyPosition', () => {
  it('sends set_fen then enables analysis', () => {
    const cmds: Command[] = [];
    applyPosition((c) => cmds.push(c), { kind: 'position', site: 'lichess', fen: 'FEN', orientation: 'white', turn: 'w' });
    expect(cmds).toEqual([
      { type: 'set_fen', fen: 'FEN' },
      { type: 'set_analysis_enabled', enabled: true },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/panelClient.applyPosition.test.ts`
Expected: FAIL — `applyPosition` not exported.

- [ ] **Step 3: Add the pure helper to `panelClient.ts`**

Add near the top-level exports (do not disturb `createPanelClient`):

```ts
// extension/src/lib/panelClient.ts  (add this export)
import type { PositionMessage } from './messages';

/** Feed an incoming board position into the orchestrator: load it, then analyze. */
export function applyPosition(send: (cmd: Command) => void, m: PositionMessage): void {
  send({ type: 'set_fen', fen: m.fen });
  send({ type: 'set_analysis_enabled', enabled: true });
}
```

(`Command` is already imported in this file per Plan 1.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/panelClient.applyPosition.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the runtime listener + source badge into `Panel.svelte`**

Add to the `<script>` (after `const client = createPanelClient(...)`):

```ts
import { onMount, onDestroy } from 'svelte';
import { applyPosition } from '../../src/lib/panelClient';
import { isPositionMessage, type ExtMessage } from '../../src/lib/messages';
import { browser } from 'wxt/browser';

let source: 'manual' | 'chesscom' | 'lichess' = 'manual';
let boardOrientation: 'white' | 'black' = 'white';

function onMessage(msg: ExtMessage) {
  if (!isPositionMessage(msg)) return;
  source = msg.site;
  currentFen = msg.fen;
  boardOrientation = msg.orientation;
  analyzing = true;
  applyPosition(client.send, msg);
}

onMount(() => browser?.runtime?.onMessage?.addListener?.(onMessage));
onDestroy(() => browser?.runtime?.onMessage?.removeListener?.(onMessage));
```

Change the `Board`/`EvalBar` orientation from the hardcoded `const orientation = 'white'` to use `boardOrientation`, and add a source indicator with a testid. Replace the fixed `orientation` usages:

```svelte
<EvalBar {evalDto} orientation={boardOrientation} />
<Board fen={currentFen} orientation={boardOrientation} {lines} onMove={() => { revertSignal += 1; }} {revertSignal} />
...
<p data-testid="source" class="source">Source: {source}</p>
```

(Keep the manual FEN box working — `loadFen()` should also set `source = 'manual'`.)

- [ ] **Step 6: Add a Panel test that an incoming position drives the board (fake `browser`)**

```ts
// extension/src/ui/Panel.position.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

// The `browser` global must be stubbed BEFORE Panel's transitive
// `import { browser } from 'wxt/browser'` evaluates — ES imports hoist above
// top-level statements, so use vi.hoisted(). @wxt-dev/browser only picks
// globalThis.browser when runtime.id is truthy, so include an `id`.
const { listeners } = vi.hoisted(() => {
  const listeners: ((m: unknown) => void)[] = [];
  vi.stubGlobal('browser', {
    runtime: {
      id: 'test',
      getURL: (p: string) => p,
      onMessage: { addListener: (f: (m: unknown) => void) => listeners.push(f), removeListener: () => {} },
      sendMessage: async () => {},
    },
  });
  return { listeners };
});
// Avoid constructing a real engine Worker in jsdom (paths resolve from src/ui/):
vi.mock('../engine/wasmEngine', () => ({ loadWasmEngine: async () => ({ send() {}, onLine() {}, dispose() {} }) }));

import Panel from '../../entrypoints/sidepanel/Panel.svelte';

describe('Panel position ingest', () => {
  beforeEach(() => { listeners.length = 0; });
  it('updates the shown FEN and source when a position arrives', async () => {
    const { getByTestId } = render(Panel);
    listeners.forEach((f) => f({ kind: 'position', site: 'lichess', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1', orientation: 'white', turn: 'b' }));
    await Promise.resolve();
    expect(getByTestId('current-fen').textContent).toContain('4P3');
    expect(getByTestId('source').textContent).toContain('lichess');
  });
});
```

Adjust the import path of `wasmEngine` in the `vi.mock` to match Panel's actual import specifier (`../../src/engine/wasmEngine`).

- [ ] **Step 7: Run tests + check**

Run: `npx vitest run src/lib/panelClient.applyPosition.test.ts src/ui/Panel.position.test.ts`
Expected: PASS.
Run: `npm run check`
Expected: 0/0.

- [ ] **Step 8: Commit**

```bash
git add extension/src/lib/panelClient.ts extension/entrypoints/sidepanel/Panel.svelte extension/src/lib/panelClient.applyPosition.test.ts extension/src/ui/Panel.position.test.ts
git commit -m "feat(ext): panel ingests live positions -> set_fen + auto-analyze"
```

---

## Task 8: Manifest — host permissions + build both browsers

**Files:**
- Modify: `extension/wxt.config.ts`

- [ ] **Step 1: Add host permissions for the two adapter sites**

In `wxt.config.ts` `manifest`, add `host_permissions` (leave existing keys intact):

```ts
    permissions: ['storage', 'activeTab'],
    host_permissions: ['*://*.chess.com/*', '*://lichess.org/*'],
```

(`activeTab` is added now so it is present for the vision path in Part C. The content script `matches` in `entrypoints/content.ts` already scopes injection to these sites; `host_permissions` lets the content script run there without a broad `<all_urls>`.)

- [ ] **Step 2: Build Chrome**

Run: `npm run build`
Expected: build succeeds; `.output/chrome-mv3/manifest.json` contains `host_permissions` for chess.com + lichess and a `content_scripts` entry matching them.

- [ ] **Step 3: Build Firefox**

Run: `npm run build:firefox`
Expected: build succeeds; `.output/firefox-mv2/manifest.json` present with the content script.

- [ ] **Step 4: Commit**

```bash
git add extension/wxt.config.ts
git commit -m "feat(ext): scope host_permissions to chess.com + lichess"
```

---

# PART C — Vision path (captureVisibleTab → reused vision worker)

## Task 9: Vision assets + onnxruntime-web dependency

**Files:**
- Modify: `extension/package.json` (add dep + copy script + hooks)
- Create: `extension/scripts/copy-vision-assets.mjs`
- Modify: `extension/wxt.config.ts` (WAR + optimizeDeps)

- [ ] **Step 1: Add the dependency**

Run: `npm install onnxruntime-web@1.27.0`
(This is the exact version the desktop app resolves — `app/package.json` has `^1.27.0`, installed `1.27.0`. Pinning the same version keeps the staged `.wasm` in lockstep with the runtime.)

Verify the wasm exists:
Run: `ls node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm`
Expected: the file is listed.

- [ ] **Step 2: Create the staging script (mirrors `app/scripts/copy-vision-assets.mjs`)**

```js
// extension/scripts/copy-vision-assets.mjs
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUB = join(here, '..', 'public');

// 1. Model: reuse the desktop app's model (single source of truth).
const MODEL_SRC = join(here, '..', '..', 'app', 'models', 'pieces.onnx');
if (!existsSync(MODEL_SRC)) { console.error(`[copy-vision-assets] missing ${MODEL_SRC}`); process.exit(1); }
mkdirSync(join(PUB, 'models'), { recursive: true });
copyFileSync(MODEL_SRC, join(PUB, 'models', 'pieces.onnx'));

// 2. ORT runtime: exactly one wasm variant.
const ORT_WASM = 'ort-wasm-simd-threaded.wasm';
const ORT_SRC = join(here, '..', 'node_modules', 'onnxruntime-web', 'dist', ORT_WASM);
if (!existsSync(ORT_SRC)) { console.error(`[copy-vision-assets] missing ${ORT_SRC} — run npm install`); process.exit(1); }
mkdirSync(join(PUB, 'ort'), { recursive: true });
copyFileSync(ORT_SRC, join(PUB, 'ort', ORT_WASM));

console.log(`[copy-vision-assets] staged pieces.onnx + ${ORT_WASM} into public/`);
```

- [ ] **Step 3: Wire the script into package.json hooks**

Edit `extension/package.json` scripts so `predev`/`prebuild` run BOTH copy scripts:

```json
    "copy-vision-assets": "node scripts/copy-vision-assets.mjs",
    "predev": "node scripts/copy-engine.mjs && node scripts/copy-vision-assets.mjs",
    "prebuild": "node scripts/copy-engine.mjs && node scripts/copy-vision-assets.mjs",
```

- [ ] **Step 4: Run the copy script and verify staging**

Run: `npm run copy-vision-assets`
Expected: `public/models/pieces.onnx` and `public/ort/ort-wasm-simd-threaded.wasm` exist.
Run: `ls -la public/models public/ort`
Expected: both files present.

- [ ] **Step 5: Add WAR + keep ORT out of dep pre-bundling in `wxt.config.ts`**

In `manifest.web_accessible_resources`, extend the resources list:

```ts
    web_accessible_resources: [
      { resources: ['engine/*', 'models/*', 'ort/*'], matches: ['<all_urls>'] },
    ],
```

In the `vite: () => ({ ... })` return, add `optimizeDeps.exclude` (keep the existing `resolve.alias` and `worker`):

```ts
  vite: () => ({
    resolve: { alias: { '@core': resolve(__dirname, '../app/src') } },
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['onnxruntime-web'] },
  }),
```

- [ ] **Step 6: Commit**

```bash
git add extension/package.json extension/package-lock.json extension/scripts/copy-vision-assets.mjs extension/wxt.config.ts
git commit -m "chore(ext): stage ONNX model + ORT wasm; add onnxruntime-web dep"
```

---

## Task 10: Extension vision worker (reuses @core vision logic)

**Files:**
- Create: `extension/src/vision/vision-worker.ts`

**Rationale:** the desktop `@core/vision/vision-worker.ts` hardcodes `/models/...` and `/ort/...` absolute paths, which are wrong in an extension. We write a thin extension worker that reuses the pure `@core` vision classes (`Tracker`, `PieceClassifier`, `ortRunner`) and points ORT at extension-relative URLs via `self.location.origin`. No `app/` change. This worker is bundled by Vite (it imports TS + onnxruntime-web), spawned in Task 12 via `new URL('../vision/vision-worker.ts', import.meta.url)`.

This task has no unit test (a worker + real ORT can't run in jsdom); it is exercised by the manual gate. Verify only that it type-checks and bundles.

- [ ] **Step 1: Write the worker (copy of the @core worker's protocol, extension asset URLs)**

```ts
// extension/src/vision/vision-worker.ts
/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import { Tracker } from '@core/vision/tracker';
import { PieceClassifier, ortRunner, type InferenceLike } from '@core/vision/pieces';
import type { RgbaImage } from '@core/lib/capture';
import type { Orientation } from '@core/vision/types';

// Extension pages/workers run at chrome-extension://<id>/ — resolve staged assets there.
const base = self.location.origin;
ort.env.wasm.wasmPaths = { wasm: `${base}/ort/ort-wasm-simd-threaded.wasm` };
ort.env.wasm.numThreads = 1;

let trackerPromise: Promise<Tracker> | null = null;
function getTracker(): Promise<Tracker> {
  if (!trackerPromise) {
    trackerPromise = ort.InferenceSession
      .create(`${base}/models/pieces.onnx`, { executionProviders: ['wasm'] })
      .then((session) => new Tracker(new PieceClassifier(ortRunner(session as unknown as InferenceLike, ort.Tensor))));
  }
  return trackerPromise;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { id: number; type: 'detect'; image: RgbaImage }
    | { type: 'setSideOverride'; white: boolean | null }
    | { type: 'setOrientationOverride'; orientation: Orientation | null }
    | { type: 'reset' };
  try {
    const tracker = await getTracker();
    if (msg.type === 'setSideOverride') return void tracker.setSideOverride(msg.white);
    if (msg.type === 'setOrientationOverride') return void tracker.setOrientationOverride(msg.orientation);
    if (msg.type === 'reset') return void tracker.reset();
    if (msg.type === 'detect') {
      const result = await tracker.detectPosition(msg.image);
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result });
    }
  } catch (err) {
    if ('id' in msg) (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: String(err) });
  }
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors, 0 warnings. (If `@core/vision/pieces` or `@core/vision/tracker` export names differ, correct the imports to match — read `app/src/vision/pieces.ts` / `tracker.ts` exports.)

- [ ] **Step 3: Commit**

```bash
git add extension/src/vision/vision-worker.ts
git commit -m "feat(ext): extension vision worker reusing @core Tracker + ORT"
```

---

## Task 11: TabCapturer — captureVisibleTab → RgbaImage

**Files:**
- Create: `extension/src/lib/tabCapturer.ts`
- Test: `extension/src/lib/tabCapturer.test.ts`

**Rationale:** `captureVisibleTab` needs the tab context (call it from the background — Task 13) and returns a PNG data URL. Decoding a data URL → `RgbaImage` needs `createImageBitmap` + a canvas, absent in jsdom. So `TabCapturer` takes two **injected** collaborators: `requestCapture()` (returns the data URL, wired to the background in Task 13) and `decode(dataUrl)` (data URL → RgbaImage). The default `decode` uses `createImageBitmap` + `OffscreenCanvas`; tests inject a fake `decode`, so the pure `grab`/`grabFullDesktop`/`setRegion` + `cropImage` reuse is fully tested. `cropImage` comes from `@core/lib/capture` (reused unchanged).

**Prerequisite (Step 0):** `@core/lib/capture` has a top-level `import { invoke, isTauri } from '@tauri-apps/api/core'`, so a *runtime* import of `cropImage` drags in `@tauri-apps/api` — which is NOT currently a resolvable dep of the extension (Task 10's worker only imported the `RgbaImage` *type*, which is erased, so it dodged this). Before writing any code, run `npm install -D @tauri-apps/api@^2.11.1` (matching `app/package.json`). The extension never calls `invoke`/`isTauri` (`cropImage` is pure and neither is called at module load), so this dep only satisfies import resolution and is tree-shaken from the bundle. This is the `@core`-alias seam the memory notes; Plan 4 (`packages/core` extraction) retires it by splitting the pure image utils out of `capture.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// extension/src/lib/tabCapturer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TabCapturer } from './tabCapturer';
import type { RgbaImage } from '@core/lib/capture';

function solid(w: number, h: number): RgbaImage {
  return { data: new Uint8ClampedArray(w * h * 4).fill(1), width: w, height: h };
}

describe('TabCapturer', () => {
  it('grabFullDesktop decodes the requested capture', async () => {
    const requestCapture = vi.fn(async () => 'data:image/png;base64,AAAA');
    const decode = vi.fn(async () => solid(4, 4));
    const cap = new TabCapturer(requestCapture, decode);
    const img = await cap.grabFullDesktop();
    expect(requestCapture).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledWith('data:image/png;base64,AAAA');
    expect(img.width).toBe(4);
  });

  it('grab() crops to the active region and hands out a fresh buffer', async () => {
    const cap = new TabCapturer(async () => 'x', async () => solid(8, 8));
    cap.setRegion({ left: 2, top: 2, width: 4, height: 4 });
    const img = await cap.grab();
    expect(img.width).toBe(4);
    expect(img.height).toBe(4);
    expect(img.data.length).toBe(4 * 4 * 4); // fresh, cropped buffer
  });

  it('throws a clear error when capture returns null', async () => {
    const cap = new TabCapturer(async () => null, async () => solid(1, 1));
    await expect(cap.grabFullDesktop()).rejects.toThrow(/capture/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tabCapturer.test.ts`
Expected: FAIL — cannot find `./tabCapturer`.

- [ ] **Step 3: Implement**

```ts
// extension/src/lib/tabCapturer.ts
import { cropImage, type RgbaImage } from '@core/lib/capture';
import type { Region } from '@core/lib/region';

export type CaptureFn = () => Promise<string | null>;   // -> PNG data URL
export type DecodeFn = (dataUrl: string) => Promise<RgbaImage>;

/** Default decode: data URL -> ImageBitmap -> OffscreenCanvas -> fresh RGBA. */
export const decodeDataUrl: DecodeFn = async (dataUrl) => {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return { data, width, height }; // getImageData().data is a fresh Uint8ClampedArray
};

/** Drop-in for the desktop Capturer: same grab/grabFullDesktop/setRegion surface. */
export class TabCapturer {
  private region: Region | null = null;
  constructor(private requestCapture: CaptureFn, private decode: DecodeFn = decodeDataUrl) {}

  setRegion(region: Region | null): void { this.region = region; }

  async grabFullDesktop(): Promise<RgbaImage> {
    const dataUrl = await this.requestCapture();
    if (!dataUrl) throw new Error('captureVisibleTab returned no image (permission or restricted page?)');
    return this.decode(dataUrl);
  }

  async grab(): Promise<RgbaImage> {
    const full = await this.grabFullDesktop();
    return this.region === null ? full : cropImage(full, this.region);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tabCapturer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/tabCapturer.ts extension/src/lib/tabCapturer.test.ts
git commit -m "feat(ext): TabCapturer (captureVisibleTab -> RgbaImage) reusing cropImage"
```

---

## Task 12: TabTracker (VisionTrackerLike) + inject into the Orchestrator

**Files:**
- Create: `extension/src/vision/visionTracker.ts`
- Modify: `extension/src/lib/panelClient.ts` (accept + pass a `tracker` into the Orchestrator)
- Test: `extension/src/vision/visionTracker.test.ts`

- [ ] **Step 1: Write the failing test (fake capturer + fake worker client)**

```ts
// extension/src/vision/visionTracker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TabTracker } from './visionTracker';
import type { RgbaImage } from '@core/lib/capture';

const img = (): RgbaImage => ({ data: new Uint8ClampedArray(4).fill(9), width: 1, height: 1 });

describe('TabTracker (VisionTrackerLike)', () => {
  it('detectPosition grabs then forwards to the worker client', async () => {
    const grab = vi.fn(async () => img());
    const client = { detectPosition: vi.fn(async () => ({ fen: 'F', isLegal: true } as never)), setSideOverride: vi.fn(), setOrientationOverride: vi.fn(), reset: vi.fn() };
    const capturer = { grab, grabFullDesktop: vi.fn(async () => img()), setRegion: vi.fn() };
    const t = new TabTracker(capturer as never, client as never);
    const res = await t.detectPosition();
    expect(grab).toHaveBeenCalledOnce();
    expect(client.detectPosition).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ fen: 'F' });
  });

  it('forwards overrides + reset + region to the right collaborators', () => {
    const client = { detectPosition: vi.fn(), setSideOverride: vi.fn(), setOrientationOverride: vi.fn(), reset: vi.fn() };
    const capturer = { grab: vi.fn(), grabFullDesktop: vi.fn(), setRegion: vi.fn() };
    const t = new TabTracker(capturer as never, client as never);
    t.setSideOverride(true); t.setOrientationOverride('black_bottom'); t.reset(); t.setRegion(null);
    expect(client.setSideOverride).toHaveBeenCalledWith(true);
    expect(client.setOrientationOverride).toHaveBeenCalledWith('black_bottom');
    expect(client.reset).toHaveBeenCalledOnce();
    expect(capturer.setRegion).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/vision/visionTracker.test.ts`
Expected: FAIL — cannot find `./visionTracker`.

- [ ] **Step 3: Implement `TabTracker`**

```ts
// extension/src/vision/visionTracker.ts
import type { VisionTrackerLike } from '@core/core/orchestrator';
import type { AssembledPosition } from '@core/vision/position';
import type { RgbaImage } from '@core/lib/capture';
import type { Region } from '@core/lib/region';
import { VisionWorkerClient } from '@core/vision/visionClient';
import { TabCapturer, type CaptureFn } from '../lib/tabCapturer';

interface CapturerLike {
  grab(): Promise<RgbaImage>;
  grabFullDesktop(): Promise<RgbaImage>;
  setRegion(r: Region | null): void;
}

/** Extension VisionTrackerLike: capture the tab, detect via the reused worker client. */
export class TabTracker implements VisionTrackerLike {
  constructor(private capturer: CapturerLike, private client: VisionWorkerClient) {}
  setRegion(r: { left: number; top: number; width: number; height: number } | null): void { this.capturer.setRegion(r); }
  setSideOverride(white: boolean | null): void { this.client.setSideOverride(white); }
  setOrientationOverride(o: 'white_bottom' | 'black_bottom' | null): void { this.client.setOrientationOverride(o); }
  reset(): void { this.client.reset(); }
  grabFullDesktop(): Promise<RgbaImage> { return this.capturer.grabFullDesktop(); }
  async detectPosition(): Promise<AssembledPosition | null> {
    const image = await this.capturer.grab();
    return this.client.detectPosition(image);
  }
}

/** Build a live tracker: spawn the vision worker, wrap TabCapturer + VisionWorkerClient. */
export function makeTabTracker(requestCapture: CaptureFn): TabTracker {
  const worker = new Worker(new URL('./vision-worker.ts', import.meta.url), { type: 'module' });
  return new TabTracker(new TabCapturer(requestCapture), new VisionWorkerClient(worker));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/vision/visionTracker.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Let `createPanelClient` accept an optional tracker and pass it through**

In `panelClient.ts`, change the factory signature and the `new Orchestrator(...)` call so the vision tracker is injected (default `undefined` keeps all Plan-1 tests unchanged):

```ts
// signature
export function createPanelClient(load: EngineLoader, tracker?: VisionTrackerLike) {
  ...
  const orch = new Orchestrator(applyFrame, {
    engine: engineController,
    sessionFactory: (_engine, cb) => new LazySession(cb),
    tracker,
  });
```

Add the import: `import type { VisionTrackerLike } from '@core/core/orchestrator';`

- [ ] **Step 6: Run the full suite + check**

Run: `npx vitest run`
Expected: all pass (Plan-1 panelClient tests still green — tracker defaults to undefined).
Run: `npm run check`
Expected: 0/0.

- [ ] **Step 7: Commit**

```bash
git add extension/src/vision/visionTracker.ts extension/src/vision/visionTracker.test.ts extension/src/lib/panelClient.ts
git commit -m "feat(ext): TabTracker VisionTrackerLike + optional tracker injection"
```

---

## Task 13: Capture button + background broker + capture_now wiring

**Files:**
- Modify: `extension/entrypoints/background.ts` (captureVisibleTab handler)
- Modify: `extension/entrypoints/sidepanel/Panel.svelte` (capture button, tracker construction, capture request)
- Modify: `extension/src/lib/panelClient.ts` (expose a `requestCapture` → `capture_now` path already exists via `send`)

**Design:** the panel builds `makeTabTracker(requestCapture)` where `requestCapture` messages the background; the background runs `browser.tabs.captureVisibleTab` (it has the tab context + `activeTab` granted by the toolbar-action click that opened the panel) and returns a data URL. The capture button issues `client.send({ type: 'capture_now' })`; the Orchestrator pulls `tracker.detectPosition()`, which calls `requestCapture` → background → data URL → decode → worker → `set_fen`.

- [ ] **Step 1: Add the captureVisibleTab handler to the background**

```ts
// extension/entrypoints/background.ts
// `defineBackground` and `browser` are WXT auto-imported globals (as in Plan 1's background.ts).
import type { ExtMessage, CaptureResult } from '../src/lib/messages';

export default defineBackground({
  main() {
    browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

    browser.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
      if (msg?.kind !== 'capture-request') return;
      // Capture the active tab of the current window as a PNG data URL.
      browser.tabs
        .captureVisibleTab(undefined as never, { format: 'png' })
        .then((dataUrl) => sendResponse({ kind: 'capture-result', dataUrl } satisfies CaptureResult))
        .catch((err) => sendResponse({ kind: 'capture-result', dataUrl: null, error: String(err) } satisfies CaptureResult));
      return true; // keep the message channel open for the async sendResponse
    });
  },
});
```

- [ ] **Step 2: Build the tracker + capture button in `Panel.svelte`**

In the `<script>`:

```ts
import { makeTabTracker } from '../../src/vision/visionTracker';
import type { CaptureResult } from '../../src/lib/messages';

// Ask the background to capture the visible tab; resolve to a PNG data URL (or null).
async function requestCapture(): Promise<string | null> {
  const res = (await browser.runtime.sendMessage({ kind: 'capture-request' })) as CaptureResult | undefined;
  return res?.dataUrl ?? null;
}

const tracker = makeTabTracker(requestCapture);
const client = createPanelClient(loadWasmEngine, tracker); // replaces the Plan-1 no-tracker call

function captureNow() {
  source = 'manual';           // vision-derived; not a live DOM source
  analyzing = true;
  client.send({ type: 'set_analysis_enabled', enabled: true });
  client.send({ type: 'capture_now' });
}
```

In the markup, add a capture button near the other controls:

```svelte
<button data-testid="capture" on:click={captureNow}>Capture screen</button>
```

- [ ] **Step 3: Guard the jsdom Panel tests — `makeTabTracker` constructs a real Worker**

After Task 13's edit, `Panel.svelte` calls `makeTabTracker(...)` at module scope, which does `new Worker(new URL('./vision-worker.ts', ...))` — this throws in jsdom. Add this mock to the top of **both** `src/ui/Panel.position.test.ts` **and** Plan 1's existing `src/ui/Panel.test.ts` (any test that renders `Panel`). Path resolves from `src/ui/`:

```ts
vi.mock('../vision/visionTracker', () => ({ makeTabTracker: () => ({
  detectPosition: async () => null, grabFullDesktop: async () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
  setRegion() {}, setSideOverride() {}, setOrientationOverride() {}, reset() {},
}) }));
```

If `Panel.test.ts` renders `Panel` without a `browser` global, also add the `vi.stubGlobal('browser', …)` and `vi.mock('../engine/wasmEngine', …)` stubs from Task 7 Step 6 there (Task 7's `browser?.…?.` optional chaining keeps it from crashing, but the tracker mock is required).

- [ ] **Step 4: Run the suite + check**

Run: `npx vitest run`
Expected: all pass (Panel tests use the mocked tracker; no real Worker).
Run: `npm run check`
Expected: 0/0.

- [ ] **Step 5: Build both browsers**

Run: `npm run build && npm run build:firefox`
Expected: both succeed. Confirm `.output/chrome-mv3/` contains `models/pieces.onnx`, `ort/ort-wasm-simd-threaded.wasm`, and the bundled vision worker chunk.

- [ ] **Step 6: Commit**

```bash
git add extension/entrypoints/background.ts extension/entrypoints/sidepanel/Panel.svelte extension/src/ui/Panel.position.test.ts
git commit -m "feat(ext): on-demand screen capture -> vision -> analysis"
```

---

# PART D — Close-out

## Task 14: Full gate, docs, and manual-test checklist

**Files:**
- Modify: `CLAUDE.md` (note the extension board sources, if the extension is documented there) — only if a browser-extension section exists; otherwise skip.

- [ ] **Step 1: Green the whole automated gate**

Run: `npx vitest run`
Expected: all tests pass (Plan 1's 13 + the new adapter/observe/message/driver/capturer/tracker/panel tests).
Run: `npm run check`
Expected: 0 errors, 0 warnings.
Run: `npm run build && npm run build:firefox`
Expected: both builds succeed.

- [ ] **Step 2: Confirm `app/` is byte-for-byte untouched**

From the worktree root:
Run: `git status --porcelain app/`
Expected: empty output — no modifications under `app/`. (The plan only reads `app/models/pieces.onnx` via the copy script and imports via the `@core` alias; it never edits `app/`.)

- [ ] **Step 3: Write the manual cross-browser gate checklist into the commit message / PR body**

Manual gate (human, both Chrome and Firefox):
1. Load unpacked — Chrome: `chrome://extensions` → Load unpacked → `extension/.output/chrome-mv3`. Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → `extension/.output/firefox-mv2/manifest.json`.
2. **DOM path:** open a live game on `lichess.org` and on `chess.com`; open the side panel; confirm the board + eval/best-line update automatically as moves are played (live). Confirm the `Source:` indicator shows `lichess` / `chesscom`.
3. **Turn correctness:** confirm the eval sign matches the side to move (a known winning side stays positive for that side).
4. **Vision path:** open an arbitrary page showing a board (e.g. a YouTube chess video, paused); click **Capture screen**; confirm the reconstructed board + eval appear. Confirm `activeTab` capture works without an `<all_urls>` prompt.
5. **Degradation:** on a page with no adapter and no visible board, Capture shows a clear error, and the manual FEN box still analyzes.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(ext): Plan 2 board sources complete — gates green"
```

- [ ] **Step 5: Update the project memory**

Update `browser-extension.md` memory: Plan 2 IMPLEMENTED (DOM adapters chess.com/lichess + vision capture path), tests/check/builds green, **manual cross-browser gate PENDING**. Note Plan 3 (UI polish) and Plan 4 (packages/core) remain.

---

## Known limitations / risks (surface in the PR; validated by the manual gate)

- **`captureVisibleTab` permission:** relies on `activeTab` granted by the toolbar-action click that opens the panel. If a subsequent capture is denied (gesture/permission edge cases, or a navigated tab), the fallback is to add `host_permissions`/optional `<all_urls>` — deferred unless the manual gate shows it's needed.
- **Restricted pages:** `captureVisibleTab` is blocked on `chrome://`, the Web Store, and PDF viewers — the panel surfaces the capture error; DOM sites are unaffected.
- **Adapter fragility:** chess.com/lichess can change markup; `readPosition()` returning `null` degrades to the manual FEN box and (on demand) the vision path. Selectors are verified against real fixtures in Tasks 2–3; re-capture fixtures if a site changes.
- **Multi-tab:** the panel accepts positions from any content script via `runtime.sendMessage`. With multiple adapter tabs open, the latest wins. Per-active-tab gating is deferred to Plan 3 (UI polish).
- **Lichess square math:** depends on `cg-board`'s measured width (`getBoundingClientRect`), correct on a real page; if lichess switches piece positioning away from px `translate`, re-derive in the adapter (vision remains the fallback).
- **ORT bundling under WXT:** `optimizeDeps.exclude: ['onnxruntime-web']` + the `onnxruntime-web/wasm` sub-path import + pinned `wasmPaths` keep ORT from doing a forbidden dynamic `.mjs` import. If the production build emits a spurious ORT wasm into the output, add a `postbuild` prune analogous to the desktop `prune-dist-ort.mjs`.
