# Browser Extension — Plan 3: Panel Polish, Settings & Error States — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the extension side panel from a dev scaffold into a product-quality analysis surface: a restructured layout, a persisted settings surface, and the error/empty states that currently fail silently.

**Architecture:** Reuse-first. All engine/board logic stays in `@core`; new pieces are small extension-local modules (a settings store, two pure helpers, two presentational Svelte components) plus one restructured `Panel.svelte`. `app/` is **not** touched. One new content→panel message (`adapter-status`) surfaces a broken site adapter.

**Tech Stack:** WXT (MV3/MV2), Svelte 5 (legacy API — `export let`, `$:`, `on:`; **no runes**), TypeScript, Vitest + @testing-library/svelte (jsdom). `@core` alias → `../app/src`.

**Spec:** `docs/superpowers/specs/2026-07-11-browser-extension-3-panel-polish-design.md`

**Conventions (read before starting):**
- All commands run from `extension/`. Tests: `npx vitest run <file>`. Full suite: `npm run test`. Type-check: `npm run check`. Builds: `npm run build` and `npm run build:firefox`.
- The `browser` global comes from `wxt/browser`; `@wxt-dev/browser` resolves `globalThis.browser` only when `runtime.id` is truthy, so test stubs MUST live in `vi.hoisted()` with `runtime: { id: 'test-extension' }` (ES imports hoist above plain `vi.stubGlobal`).
- New Svelte components live in `entrypoints/sidepanel/` (co-located with `Panel.svelte`); their tests live in `src/ui/` and import via `../../entrypoints/sidepanel/X.svelte` (matches the existing Panel test).
- Commit after every task with the repo trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `storage` permission is **already** in `wxt.config.ts` — no manifest change needed.

**Baseline:** 34 vitest tests green, svelte-check 0/0, both browser builds green. Keep them green throughout.

---

## Task 1: Settings store (`settings.ts`)

The persisted settings model: a Svelte writable hydrated from `browser.storage.local`, with a `patchSettings()` that writes through.

**Files:**
- Create: `extension/src/lib/settings.ts`
- Test: `extension/src/lib/settings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/lib/settings.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory browser.storage.local. Must be in vi.hoisted with a truthy runtime.id
// so @wxt-dev/browser resolves our stub (see conventions).
const store = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  vi.stubGlobal('browser', {
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (obj: Record<string, unknown>) => { Object.assign(store, obj); },
      },
    },
  });
  return store;
});

import { settings, DEFAULTS, hydrateSettings, patchSettings } from './settings';
import { get } from 'svelte/store';

describe('settings store', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; settings.set({ ...DEFAULTS }); });

  it('starts at defaults', () => {
    expect(get(settings)).toEqual(DEFAULTS);
    expect(DEFAULTS).toEqual({ lines: 3, thinkingMs: 5000, autoAnalyze: true, arrows: true, liveSiteReading: true });
  });

  it('patchSettings updates the store and persists', async () => {
    patchSettings({ lines: 5, thinkingMs: 10000 });
    expect(get(settings)).toMatchObject({ lines: 5, thinkingMs: 10000 });
    // written through to storage under the 'settings' key
    expect(store['settings']).toMatchObject({ lines: 5, thinkingMs: 10000 });
  });

  it('hydrateSettings merges saved values over defaults', async () => {
    store['settings'] = { arrows: false, thinkingMs: 2000 };
    await hydrateSettings();
    expect(get(settings)).toEqual({ ...DEFAULTS, arrows: false, thinkingMs: 2000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/settings.test.ts`
Expected: FAIL — `Failed to resolve import './settings'` / module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extension/src/lib/settings.ts
import { writable } from 'svelte/store';
import { browser } from 'wxt/browser';

/** User-tunable analysis + UI preferences, persisted across panel opens. */
export interface Settings {
  lines: number;          // MultiPV, 1..5
  thinkingMs: number;     // search budget per position: 2000 | 5000 | 10000
  autoAnalyze: boolean;   // analyze automatically when a new position arrives
  arrows: boolean;        // draw best-move arrows on the board
  liveSiteReading: boolean; // auto-read chess.com / lichess boards
}

export const DEFAULTS: Settings = {
  lines: 3, thinkingMs: 5000, autoAnalyze: true, arrows: true, liveSiteReading: true,
};

const KEY = 'settings';

/** Reactive settings. Seeded with DEFAULTS; call hydrateSettings() once on mount. */
export const settings = writable<Settings>({ ...DEFAULTS });

/** Load persisted settings over the defaults. Silent on any storage error. */
export async function hydrateSettings(): Promise<void> {
  try {
    const got = await browser.storage?.local?.get?.(KEY);
    const saved = got?.[KEY] as Partial<Settings> | undefined;
    if (saved) settings.set({ ...DEFAULTS, ...saved });
  } catch { /* keep whatever is in the store */ }
}

/** Merge a partial change into the store and write the whole object back. */
export function patchSettings(partial: Partial<Settings>): void {
  settings.update((s) => {
    const next = { ...s, ...partial };
    void browser.storage?.local?.set?.({ [KEY]: next });
    return next;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/settings.ts extension/src/lib/settings.test.ts
git commit -m "feat(ext): persisted settings store (lines, thinking time, toggles)"
```

---

## Task 2: Settings → engine commands (`settingsToCommands.ts`)

A pure function turning the engine-affecting settings into the exact `Command`s the orchestrator understands. Keeps the wiring testable without a running engine.

**Files:**
- Create: `extension/src/lib/settingsToCommands.ts`
- Test: `extension/src/lib/settingsToCommands.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/lib/settingsToCommands.test.ts
import { describe, it, expect } from 'vitest';
import { settingsToCommands } from './settingsToCommands';
import { DEFAULTS } from './settings';

describe('settingsToCommands', () => {
  it('maps thinking time -> set_options movetime (ms) and lines -> MultiPV', () => {
    const cmds = settingsToCommands({ ...DEFAULTS, lines: 4, thinkingMs: 10000 });
    expect(cmds).toEqual([
      { type: 'set_options', movetime: 10000 },
      { type: 'set_engine_option', name: 'MultiPV', value: '4' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/settingsToCommands.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extension/src/lib/settingsToCommands.ts
import type { Command } from '@core/lib/types';
import type { Settings } from './settings';

/** The engine-affecting settings as orchestrator commands. movetime is ms
 *  (verbatim into the session's timeMs); lines maps to the MultiPV UCI option. */
export function settingsToCommands(s: Settings): Command[] {
  return [
    { type: 'set_options', movetime: s.thinkingMs },
    { type: 'set_engine_option', name: 'MultiPV', value: String(s.lines) },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/settingsToCommands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/settingsToCommands.ts extension/src/lib/settingsToCommands.test.ts
git commit -m "feat(ext): settings -> orchestrator commands (movetime + MultiPV)"
```

---

## Task 3: Replay stored engine options on load (`engineController.ts`)

**Problem this fixes:** the orchestrator only forwards `set_engine_option` to a *started* engine; before the first search it merely stores the override (`storeSetOption`). The desktop `engineClient` replays stored overrides via `applyOptions` when the engine loads, but the extension's controller does not — so a `MultiPV` set before the first analysis never reaches the engine. Mirror the desktop: apply `getOverrides(engineId)` on load. The orchestrator calls `engine.select(engineId)` synchronously before the first `session.start`, so the controller knows the id by the time the async load resolves.

**Files:**
- Modify: `extension/src/lib/engineController.ts`
- Test: `extension/src/lib/engineController.test.ts` (add a case; keep existing ones)

- [ ] **Step 1: Write the failing test**

Append this `describe` to the existing `engineController.test.ts` (leave current tests intact):

```typescript
import { setOption as storeSetOption, resetAll as storeResetAll } from '@core/lib/engineOptions';
import type { UciOption } from '@core/engine/uciOptions';

describe('engineController option replay on load', () => {
  it('applies stored MultiPV override when the engine loads', async () => {
    storeResetAll('stockfish');
    storeSetOption('stockfish', 'MultiPV', '3'); // set BEFORE any engine exists
    const sent: string[] = [];
    const multipv: UciOption = { name: 'MultiPV', type: 'spin', default: '1', min: 1, max: 5 };
    const fakeEngine = { send: (c: string) => sent.push(c), onLine() {}, dispose() {}, options: [multipv] };

    const { createEngineController } = await import('./engineController');
    const ctrl = createEngineController(async () => fakeEngine);
    await ctrl.ensureEngine();

    expect(sent).toContain('setoption name MultiPV value 3');
    storeResetAll('stockfish');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engineController.test.ts`
Expected: FAIL — `sent` does not contain the setoption line (overrides never applied on load).

- [ ] **Step 3: Write minimal implementation**

Edit `extension/src/lib/engineController.ts`. Add the two `@core` imports at the top, track the selected id, and apply overrides inside `ensureEngine`'s load callback:

```typescript
import type { UciEngine } from '@core/engine/engine';
import type { OrchestratorEngine } from '@core/core/orchestrator';
import { formatSetOption } from '@core/engine/uciOptions';
import { applyOptions } from '@core/engine/engine';
import { getOverrides } from '@core/lib/engineOptions';

export type EngineLoader = () => Promise<UciEngine>;

export function createEngineController(load: EngineLoader): OrchestratorEngine & {
  select(id?: string): void;
  setOption(name: string, value?: string): void;
  ensureEngine(): Promise<UciEngine>;
  currentEngine(): UciEngine | null;
  dispose(): void;
} {
  let engine: UciEngine | null = null;
  let loadPromise: Promise<UciEngine> | null = null;
  // The orchestrator calls select(engineId) before the first session.start, so we
  // know which engine's stored overrides to replay when the async load resolves.
  let engineId = 'stockfish';

  return {
    select(id?: string) { if (id) engineId = id; },
    setOption(name: string, value?: string) {
      if (!engine) return;
      engine.send(formatSetOption(name, value));
    },
    ensureEngine() {
      if (!loadPromise) {
        const p = load().then((e) => {
          engine = e;
          // Replay persisted overrides (e.g. MultiPV) the started engine never heard.
          applyOptions(e, getOverrides(engineId), e.options ?? []);
          return e;
        });
        loadPromise = p;
        p.catch(() => { if (loadPromise === p) loadPromise = null; });
      }
      return loadPromise;
    },
    currentEngine() { return engine; },
    dispose() { engine?.dispose(); engine = null; loadPromise = null; },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/engineController.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/engineController.ts extension/src/lib/engineController.test.ts
git commit -m "fix(ext): replay stored engine options (MultiPV) on engine load"
```

---

## Task 4: Panel status derivation (`panelStatus.ts`)

A pure, priority-ordered classifier producing the one primary state the panel shows. `low_confidence` is NOT here (it's a ribbon on the analysis view, handled in the Panel).

**Files:**
- Create: `extension/src/lib/panelStatus.ts`
- Test: `extension/src/lib/panelStatus.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/lib/panelStatus.test.ts
import { describe, it, expect } from 'vitest';
import { panelStatus } from './panelStatus';

const base = { lastError: null, visionStatus: 'idle' as const, adapterOk: true };

describe('panelStatus', () => {
  it('is analysis when nothing is wrong', () => {
    expect(panelStatus(base)).toBe('analysis');
  });
  it('engine-load errors win over everything', () => {
    expect(panelStatus({ ...base, lastError: 'engine failed to load: boom', visionStatus: 'no_board', adapterOk: false }))
      .toBe('engine_unavailable');
  });
  it('capture failures map to capture_denied', () => {
    expect(panelStatus({ ...base, lastError: 'capture failed: no permission' })).toBe('capture_denied');
  });
  it('a broken adapter beats a no_board vision status', () => {
    expect(panelStatus({ ...base, adapterOk: false, visionStatus: 'no_board' })).toBe('adapter_broke');
  });
  it('no_board when vision found nothing', () => {
    expect(panelStatus({ ...base, visionStatus: 'no_board' })).toBe('no_board');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/panelStatus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extension/src/lib/panelStatus.ts
import type { StateFrame } from '@core/lib/types';

export type PanelStatus =
  | 'analysis' | 'no_board' | 'adapter_broke' | 'capture_denied' | 'engine_unavailable';

/** Derive the single primary panel state, most-severe first. Error text is matched
 *  against the orchestrator's existing ErrorFrame wording (no core change). */
export function panelStatus(input: {
  lastError: string | null;
  visionStatus: StateFrame['visionStatus'] | undefined;
  adapterOk: boolean;
}): PanelStatus {
  const err = input.lastError ?? '';
  if (/engine failed to load|handshake timed out/i.test(err)) return 'engine_unavailable';
  if (/capture failed|screen capture/i.test(err)) return 'capture_denied';
  if (!input.adapterOk) return 'adapter_broke';
  if (input.visionStatus === 'no_board') return 'no_board';
  return 'analysis';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/panelStatus.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/panelStatus.ts extension/src/lib/panelStatus.test.ts
git commit -m "feat(ext): panel status classifier (engine/capture/adapter/no-board)"
```

---

## Task 5: Adapter-broke signal (`messages.ts`, adapters, `contentDriver.ts`)

Give the content driver a way to tell the panel "a known site is present but its board can't be read" so the panel can offer the vision fallback. One new message kind + one cheap adapter method.

**Files:**
- Modify: `extension/src/lib/messages.ts`
- Modify: `extension/src/lib/adapters/types.ts`
- Modify: `extension/src/lib/adapters/chesscom.ts`
- Modify: `extension/src/lib/adapters/lichess.ts`
- Modify: `extension/src/lib/contentDriver.ts`
- Test: `extension/src/lib/contentDriver.test.ts` (add cases; keep existing)

- [ ] **Step 1: Write the failing test**

Add to `extension/src/lib/contentDriver.test.ts` (keep the existing tests):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runContentDriver } from './contentDriver';
import type { SiteAdapter } from './adapters/types';

function fakeAdapter(over: Partial<SiteAdapter>): SiteAdapter {
  return {
    site: 'chesscom',
    matches: () => true,
    readPosition: () => null,
    observe: () => () => {},
    boardPresent: () => false,
    ...over,
  };
}

describe('contentDriver adapter-status', () => {
  it('emits adapter-status ok:false when a board is present but unreadable', () => {
    const sent: any[] = [];
    runContentDriver(fakeAdapter({ readPosition: () => null, boardPresent: () => true }), (m) => sent.push(m));
    expect(sent).toContainEqual({ kind: 'adapter-status', site: 'chesscom', ok: false });
  });

  it('stays silent when no board element is present (not a chess page)', () => {
    const sent: any[] = [];
    runContentDriver(fakeAdapter({ readPosition: () => null, boardPresent: () => false }), (m) => sent.push(m));
    expect(sent).toEqual([]);
  });

  it('emits ok:true then the position when a read recovers', () => {
    const sent: any[] = [];
    let ok = false;
    const adapter = fakeAdapter({
      readPosition: () => (ok ? { fen: '8/8/8/8/8/8/8/8 w - - 0 1', orientation: 'white', turn: 'w' } : null),
      boardPresent: () => true,
      observe: (cb) => { (adapter as any)._cb = cb; return () => {}; },
    });
    runContentDriver(adapter, (m) => sent.push(m)); // first read: null -> ok:false
    ok = true; (adapter as any)._cb();               // recovery read
    const kinds = sent.map((m) => m.kind);
    expect(kinds).toEqual(['adapter-status', 'adapter-status', 'position']);
    expect(sent[1]).toEqual({ kind: 'adapter-status', site: 'chesscom', ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/contentDriver.test.ts`
Expected: FAIL — `boardPresent` not on the type / `adapter-status` never emitted.

- [ ] **Step 3a: Add the message kind (`messages.ts`)**

```typescript
// extension/src/lib/messages.ts — add below CaptureResult, extend the union
/** Content script -> panel: whether the site adapter can currently read its board.
 *  ok:false => board element present but unparsed (offer the vision fallback). */
export interface AdapterStatusMessage { kind: 'adapter-status'; site: 'chesscom' | 'lichess'; ok: boolean; }

export type ExtMessage = PositionMessage | CaptureRequest | CaptureResult | AdapterStatusMessage;
```

- [ ] **Step 3b: Add `boardPresent` to the adapter interface (`adapters/types.ts`)**

```typescript
// extension/src/lib/adapters/types.ts — add to SiteAdapter, after observe()
  /** Cheap check: is this site's board container in the DOM at all? Distinguishes
   *  "not a chess page" (false) from "board present but unreadable" (true + null read). */
  boardPresent(): boolean;
```

- [ ] **Step 3c: Implement `boardPresent` on chess.com (`adapters/chesscom.ts`)**

Add a method using the same root selector the adapter already relies on. chess.com boards are `wc-chess-board` / `.board`; use whichever the file's `readPosition` queries. Example (match the existing selector in the file):

```typescript
  boardPresent(): boolean {
    return !!document.querySelector('wc-chess-board, .board, chess-board');
  },
```

- [ ] **Step 3d: Implement `boardPresent` on lichess (`adapters/lichess.ts`)**

```typescript
  boardPresent(): boolean {
    return !!document.querySelector('.cg-wrap cg-board, cg-board');
  },
```

- [ ] **Step 3e: Emit adapter-status from the driver (`contentDriver.ts`)**

Replace the file with:

```typescript
// extension/src/lib/contentDriver.ts
import type { SiteAdapter } from './adapters/types';
import type { PositionMessage, AdapterStatusMessage } from './messages';

type Out = PositionMessage | AdapterStatusMessage;

/** Read once, then on every observed change; emit a PositionMessage per new FEN.
 *  When the board element is present but unreadable, emit adapter-status ok:false
 *  (once, on transition); clear it with ok:true when a read recovers.
 *  Returns a stop() that tears down the observer. */
export function runContentDriver(adapter: SiteAdapter, send: (m: Out) => void): () => void {
  let lastFen: string | null = null;
  let adapterOk = true; // start optimistic; only announce a *problem* or its recovery
  const emit = () => {
    const pos = adapter.readPosition();
    if (!pos) {
      // Board on the page but unparsed => broken adapter. No board => not a chess page (stay quiet).
      if (adapter.boardPresent() && adapterOk) { adapterOk = false; send({ kind: 'adapter-status', site: adapter.site, ok: false }); }
      return;
    }
    if (!adapterOk) { adapterOk = true; send({ kind: 'adapter-status', site: adapter.site, ok: true }); }
    if (pos.fen === lastFen) return;
    lastFen = pos.fen;
    send({ kind: 'position', site: adapter.site, ...pos });
  };
  emit();
  return adapter.observe(emit);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/contentDriver.test.ts src/lib/adapters`
Expected: PASS (existing adapter tests still green — they construct adapters, so add `boardPresent` there too if any adapter test builds a literal `SiteAdapter`; if an adapter test fails to compile, add the method).

Then type-check: `npm run check` — Expected: 0 errors (the `content.ts` `send` callback type must accept `Out`; if `content.ts` annotates `(m: PositionMessage)`, widen it to `ExtMessage` or `PositionMessage | AdapterStatusMessage` in the next step).

- [ ] **Step 5: Update the content entrypoint to pass the wider type (`content.ts`)**

```typescript
// extension/entrypoints/content.ts — widen the send callback type
import { adapterFor } from '../src/lib/adapters/registry';
import { runContentDriver } from '../src/lib/contentDriver';
import type { PositionMessage, AdapterStatusMessage } from '../src/lib/messages';

export default defineContentScript({
  matches: ['*://*.chess.com/*', '*://lichess.org/*'],
  main() {
    const adapter = adapterFor(location.href);
    if (!adapter) return;
    runContentDriver(adapter, (m: PositionMessage | AdapterStatusMessage) => {
      browser.runtime.sendMessage(m).catch(() => {}); // panel may be closed
    });
  },
});
```

- [ ] **Step 6: Verify + commit**

Run: `npx vitest run src/lib && npm run check`
Expected: all green, 0 type errors.

```bash
git add extension/src/lib/messages.ts extension/src/lib/adapters extension/src/lib/contentDriver.ts extension/src/lib/contentDriver.test.ts extension/entrypoints/content.ts
git commit -m "feat(ext): adapter-status signal for broken site adapters (offer capture)"
```

---

## Task 6: Source + turn badge (`SourceBadge.svelte`)

Small presentational badge. Keeps `data-testid="source"` with the source word so the existing `Panel.position.test.ts` stays green.

**Files:**
- Create: `extension/entrypoints/sidepanel/SourceBadge.svelte`
- Test: `extension/src/ui/SourceBadge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/ui/SourceBadge.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SourceBadge from '../../entrypoints/sidepanel/SourceBadge.svelte';

describe('SourceBadge', () => {
  it('shows the source label and side to move', () => {
    const { getByTestId } = render(SourceBadge, { source: 'vision', sideToMove: 'black' });
    const el = getByTestId('source');
    expect(el.textContent).toContain('vision');
    expect(el.textContent?.toLowerCase()).toContain('black');
  });

  it('labels the four sources', () => {
    for (const src of ['manual', 'vision', 'chesscom', 'lichess'] as const) {
      const { getByTestId } = render(SourceBadge, { source: src, sideToMove: 'white' });
      expect(getByTestId('source').textContent).toContain(src === 'chesscom' ? 'chess.com' : src);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/SourceBadge.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write minimal implementation**

```svelte
<!-- extension/entrypoints/sidepanel/SourceBadge.svelte -->
<script lang="ts">
  export let source: 'manual' | 'vision' | 'chesscom' | 'lichess' = 'manual';
  export let sideToMove: 'white' | 'black' = 'white';
  const LABEL = { manual: 'manual', vision: 'vision', chesscom: 'chess.com', lichess: 'lichess' };
</script>

<span class="badge {source}" data-testid="source">
  <span class="src">{LABEL[source]}</span>
  <span class="dot">·</span>
  <span class="turn">{sideToMove === 'white' ? 'White' : 'Black'} to move</span>
</span>

<style>
  .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px;
    padding: 2px 8px; border-radius: 20px; background: #2f4a63; color: #cfe4f5; }
  .badge.vision { background: #4a3f63; color: #e0d4f5; }
  .badge.manual { background: #3a3a3a; color: #ddd; }
  .src { font-weight: 600; text-transform: capitalize; }
  .dot { opacity: .6; }
  .turn { opacity: .85; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/SourceBadge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/entrypoints/sidepanel/SourceBadge.svelte extension/src/ui/SourceBadge.test.ts
git commit -m "feat(ext): SourceBadge (source + side-to-move pill)"
```

---

## Task 7: Settings surface (`SettingsPanel.svelte`)

The gear view: five controls bound to the settings store via `patchSettings`.

**Files:**
- Create: `extension/entrypoints/sidepanel/SettingsPanel.svelte`
- Test: `extension/src/ui/SettingsPanel.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/ui/SettingsPanel.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';

const store = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  vi.stubGlobal('browser', {
    runtime: { id: 'test-extension' },
    storage: { local: { get: async () => ({}), set: async (o: Record<string, unknown>) => { Object.assign(store, o); } } },
  });
  return store;
});

import SettingsPanel from '../../entrypoints/sidepanel/SettingsPanel.svelte';
import { settings, DEFAULTS } from '../../src/lib/settings';

describe('SettingsPanel', () => {
  beforeEach(() => settings.set({ ...DEFAULTS }));

  it('picks a thinking-time preset', async () => {
    const { getByTestId } = render(SettingsPanel);
    await fireEvent.click(getByTestId('time-10000'));
    expect(get(settings).thinkingMs).toBe(10000);
  });

  it('toggles arrows off', async () => {
    const { getByTestId } = render(SettingsPanel);
    await fireEvent.click(getByTestId('toggle-arrows'));
    expect(get(settings).arrows).toBe(false);
  });

  it('steps lines up', async () => {
    const { getByTestId } = render(SettingsPanel);
    await fireEvent.click(getByTestId('lines-inc'));
    expect(get(settings).lines).toBe(DEFAULTS.lines + 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/SettingsPanel.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write minimal implementation**

```svelte
<!-- extension/entrypoints/sidepanel/SettingsPanel.svelte -->
<script lang="ts">
  import { settings, patchSettings } from '../../src/lib/settings';
  const TIMES = [2000, 5000, 10000];
  const s = settings;
  function stepLines(d: number) { patchSettings({ lines: Math.min(5, Math.max(1, $s.lines + d)) }); }
</script>

<div class="settings" data-testid="settings-panel">
  <div class="row">
    <span class="name">Lines</span>
    <span class="stepper">
      <button data-testid="lines-dec" on:click={() => stepLines(-1)} aria-label="fewer lines">−</button>
      <span class="num" data-testid="lines-value">{$s.lines}</span>
      <button data-testid="lines-inc" on:click={() => stepLines(1)} aria-label="more lines">+</button>
    </span>
  </div>

  <div class="row">
    <span class="name">Thinking time</span>
    <span class="seg">
      {#each TIMES as t}
        <button data-testid={`time-${t}`} class:on={$s.thinkingMs === t}
          on:click={() => patchSettings({ thinkingMs: t })}>{t / 1000}s</button>
      {/each}
    </span>
  </div>

  <label class="row"><span class="name">Auto-analyze</span>
    <input type="checkbox" data-testid="toggle-auto" checked={$s.autoAnalyze}
      on:change={() => patchSettings({ autoAnalyze: !$s.autoAnalyze })} /></label>

  <label class="row"><span class="name">Best-move arrows</span>
    <input type="checkbox" data-testid="toggle-arrows" checked={$s.arrows}
      on:change={() => patchSettings({ arrows: !$s.arrows })} /></label>

  <label class="row"><span class="name">Live site reading</span>
    <input type="checkbox" data-testid="toggle-live" checked={$s.liveSiteReading}
      on:change={() => patchSettings({ liveSiteReading: !$s.liveSiteReading })} /></label>
</div>

<style>
  .settings { display: flex; flex-direction: column; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 10px 4px;
    border-bottom: 1px solid rgba(255,255,255,.08); font-size: 13px; }
  .row:last-child { border-bottom: none; }
  .name { font-weight: 600; }
  .stepper { display: inline-flex; align-items: center; gap: 8px; }
  .stepper button { width: 24px; height: 24px; }
  .num { min-width: 16px; text-align: center; font-variant-numeric: tabular-nums; }
  .seg { display: inline-flex; gap: 4px; }
  .seg button { padding: 3px 9px; font-variant-numeric: tabular-nums; }
  .seg button.on { background: #3a6f4a; color: #fff; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/SettingsPanel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/entrypoints/sidepanel/SettingsPanel.svelte extension/src/ui/SettingsPanel.test.ts
git commit -m "feat(ext): SettingsPanel (lines, thinking time, three toggles)"
```

---

## Task 8: Restructure the panel (`Panel.svelte`)

Integrate everything: header (SourceBadge + gear/view toggle), board + eval bar with arrows gated by settings, an eval readout above the reused `Lines`, a source-aware control row with the FEN editor behind a toggle, settings wiring (with the engine-command re-send only when lines/time change), auto-analyze + live-site-reading gating, and the status cards from `panelStatus`.

**Files:**
- Modify: `extension/entrypoints/sidepanel/Panel.svelte` (full rewrite below)
- Modify: `extension/src/ui/Panel.test.ts` (the manual-FEN test must open the FEN editor first)
- Test (new): `extension/src/ui/Panel.states.test.ts`

- [ ] **Step 1: Write the failing tests**

New file `extension/src/ui/Panel.states.test.ts` (reuse the Plan-1/2 hoisted-browser + worker mocks):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const listeners = vi.hoisted(() => {
  const listeners: ((m: unknown) => void)[] = [];
  vi.stubGlobal('browser', {
    runtime: {
      id: 'test-extension', getURL: (p: string) => p,
      onMessage: { addListener: (f: (m: unknown) => void) => listeners.push(f), removeListener: () => {} },
      sendMessage: async () => ({ dataUrl: null }),
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  });
  return listeners;
});
vi.mock('../engine/wasmEngine', () => ({ loadWasmEngine: async () => ({ send() {}, onLine() {}, dispose() {} }) }));
vi.mock('../vision/visionTracker', () => ({ makeTabTracker: () => ({
  detectPosition: async () => null, grabFullDesktop: async () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
  setRegion() {}, setSideOverride() {}, setOrientationOverride() {}, reset() {},
}) }));

import Panel from '../../entrypoints/sidepanel/Panel.svelte';

describe('Panel states + settings view', () => {
  beforeEach(() => { listeners.length = 0; });

  it('hides the FEN editor until the FEN button is clicked', async () => {
    const { queryByTestId, getByTestId } = render(Panel);
    expect(queryByTestId('fen-input')).toBeNull();
    await fireEvent.click(getByTestId('fen-toggle'));
    expect(getByTestId('fen-input')).toBeInTheDocument();
  });

  it('gear opens the settings view and back returns', async () => {
    const { getByTestId, queryByTestId } = render(Panel);
    await fireEvent.click(getByTestId('gear'));
    expect(getByTestId('settings-panel')).toBeInTheDocument();
    await fireEvent.click(getByTestId('gear')); // same button toggles back
    expect(queryByTestId('settings-panel')).toBeNull();
  });

  it('shows the adapter-broke card when a site adapter reports not-ok', async () => {
    const { getByTestId } = render(Panel);
    listeners.forEach((f) => f({ kind: 'adapter-status', site: 'chesscom', ok: false }));
    await waitFor(() => expect(getByTestId('status-card').textContent?.toLowerCase()).toContain('capture'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/Panel.states.test.ts`
Expected: FAIL — no `fen-toggle` / `gear` / `status-card` yet.

- [ ] **Step 3: Rewrite `Panel.svelte`**

```svelte
<!-- extension/entrypoints/sidepanel/Panel.svelte -->
<script lang="ts">
  import Board from '@core/components/Board.svelte';
  import EvalBar from '@core/components/EvalBar.svelte';
  import Lines from '@core/components/Lines.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { createPanelClient, applyPosition } from '../../src/lib/panelClient';
  import { loadWasmEngine } from '../../src/engine/wasmEngine';
  import { makeTabTracker } from '../../src/vision/visionTracker';
  import { isPositionMessage, type ExtMessage, type CaptureResult } from '../../src/lib/messages';
  import { settings, hydrateSettings } from '../../src/lib/settings';
  import { settingsToCommands } from '../../src/lib/settingsToCommands';
  import { panelStatus } from '../../src/lib/panelStatus';
  import SourceBadge from './SourceBadge.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import { browser } from 'wxt/browser';

  async function requestCapture(): Promise<string | null> {
    const res = (await browser.runtime.sendMessage({ kind: 'capture-request' })) as CaptureResult | undefined;
    return res?.dataUrl ?? null;
  }

  const tracker = makeTabTracker(requestCapture);
  const client = createPanelClient(loadWasmEngine, tracker);
  const panelState = client.state;
  const lastError = client.lastError;
  const s = settings;

  const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let fenInput = STARTPOS;
  let analyzing = false;
  let revertSignal = 0;
  let view: 'analysis' | 'settings' = 'analysis';
  let showFen = false;
  let source: 'manual' | 'vision' | 'chesscom' | 'lichess' = 'manual';
  let boardOrientation: 'white' | 'black' = 'white';
  let adapterOk = true; // latest adapter-status; false => board present but unreadable

  // Board mirrors the orchestrator's FEN (single source of truth; see Plan-2 fix).
  $: currentFen = $panelState?.fen ?? STARTPOS;
  $: if (source === 'vision' && $panelState?.detectedOrientation) boardOrientation = $panelState.detectedOrientation;

  // Re-send engine-affecting settings only when lines/time actually change (an arrows
  // or toggle flip must NOT restart the search).
  let lastEngineKey = '';
  $: {
    const key = `${$s.lines}|${$s.thinkingMs}`;
    if (key !== lastEngineKey) { lastEngineKey = key; for (const c of settingsToCommands($s)) client.send(c); }
  }

  function maybeAnalyze() {
    if ($s.autoAnalyze) { analyzing = true; client.send({ type: 'set_analysis_enabled', enabled: true }); }
  }
  function loadFen() {
    source = 'manual'; boardOrientation = 'white';
    lastError.set(null);
    client.send({ type: 'set_fen', fen: fenInput.trim() });
    if (analyzing) client.send({ type: 'set_analysis_enabled', enabled: true });
  }
  function toggleAnalysis() {
    analyzing = !analyzing;
    client.send({ type: 'set_analysis_enabled', enabled: analyzing });
  }
  function captureNow() {
    source = 'vision'; lastError.set(null);
    client.send({ type: 'capture_now' });
    maybeAnalyze();
  }

  function onMessage(msg: ExtMessage) {
    if (msg?.kind === 'adapter-status') { if ($s.liveSiteReading) adapterOk = msg.ok; return; }
    if (!isPositionMessage(msg)) return;
    if (!$s.liveSiteReading) return;
    adapterOk = true; source = msg.site; boardOrientation = msg.orientation; lastError.set(null);
    if ($s.autoAnalyze) { analyzing = true; applyPosition(client.send, msg); }
    else client.send({ type: 'set_fen', fen: msg.fen });
  }

  onMount(() => { hydrateSettings(); return browser?.runtime?.onMessage?.addListener?.(onMessage); });
  onDestroy(() => browser?.runtime?.onMessage?.removeListener?.(onMessage));

  $: evalDto = $panelState?.eval ?? null;
  $: lines = $panelState?.lines ?? [];
  $: depth = $panelState?.depth ?? 0;
  $: status = panelStatus({ lastError: $lastError, visionStatus: $panelState?.visionStatus, adapterOk });
  $: lowConfidence = $panelState?.visionStatus === 'low_confidence';

  const STATUS_TEXT: Record<string, { msg: string; action?: 'capture' }> = {
    engine_unavailable: { msg: 'Analysis engine unavailable. Board reconstruction still works.' },
    capture_denied: { msg: "Couldn't capture this page (try a normal web page and click again).", action: 'capture' },
    adapter_broke: { msg: "Can't read this site's board — capture it instead.", action: 'capture' },
    no_board: { msg: 'No chessboard detected. Make the board fully visible and try again.', action: 'capture' },
  };
</script>

<main class="panel">
  <header class="hdr">
    <span class="title">ChessMenthol</span>
    <SourceBadge {source} sideToMove={$panelState?.sideToMove ?? 'white'} />
    <button class="gear" data-testid="gear" aria-label="Settings"
      on:click={() => (view = view === 'settings' ? 'analysis' : 'settings')}>{view === 'settings' ? '✕' : '⚙'}</button>
  </header>

  {#if view === 'settings'}
    <SettingsPanel />
  {:else}
    {#if status !== 'analysis'}
      <div class="status" data-testid="status-card">
        <p>{STATUS_TEXT[status].msg}</p>
        {#if STATUS_TEXT[status].action === 'capture'}
          <button data-testid="status-capture" on:click={captureNow}>Capture screen</button>
        {/if}
      </div>
    {/if}

    <div class="board-row">
      <EvalBar {evalDto} orientation={boardOrientation} />
      <Board fen={currentFen} orientation={boardOrientation} {lines} showArrows={$s.arrows}
        onMove={() => { revertSignal += 1; }} {revertSignal} />
    </div>
    {#if lowConfidence}<p class="ribbon" data-testid="low-confidence">Low-confidence read — double-check the pieces.</p>{/if}

    <div class="evalcard">
      <div class="evaltop">
        <span class="score" data-testid="eval-readout">{evalDto?.text ?? '0.0'}</span>
        <span class="meta">{analyzing ? `depth ${depth}` : 'idle'}{lines[0] ? ` · best ${lines[0].san.split(' ')[0]}` : ''}</span>
      </div>
      <Lines {lines} />
    </div>

    <div class="controls">
      <button data-testid="analyze" on:click={toggleAnalysis}>{analyzing ? 'Stop' : 'Analyze'}</button>
      <button data-testid="capture" on:click={captureNow}>Capture</button>
      <button data-testid="fen-toggle" on:click={() => (showFen = !showFen)}>FEN</button>
    </div>

    {#if showFen}
      <div class="fenbox">
        <input data-testid="fen-input" bind:value={fenInput} placeholder="Paste a FEN" />
        <button data-testid="load-fen" on:click={loadFen}>Load</button>
      </div>
    {/if}

    <p data-testid="current-fen" class="fen">{currentFen}</p>
  {/if}
</main>

<style>
  .panel { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .hdr { display: flex; align-items: center; gap: 8px; }
  .hdr .title { font-weight: 700; }
  .hdr .gear { margin-left: auto; background: transparent; border: none; font-size: 16px; cursor: pointer; color: inherit; }
  .board-row { display: flex; gap: 6px; }
  .evalcard { border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .evaltop { display: flex; justify-content: space-between; align-items: baseline; }
  .evaltop .score { font-size: 20px; font-weight: 700; }
  .evaltop .meta { font-size: 11px; opacity: .6; }
  .controls { display: flex; gap: 6px; }
  .controls button { flex: 1; }
  .fenbox { display: flex; gap: 6px; }
  .fenbox input { flex: 1; }
  .status { border: 1px dashed #6a5; border-radius: 8px; padding: 10px; font-size: 12px;
    background: rgba(120,150,90,.10); display: flex; flex-direction: column; gap: 8px; }
  .ribbon { margin: 0; font-size: 11px; color: #c93; }
  .fen { font: 11px/1.3 monospace; color: #888; word-break: break-all; margin: 0; }
</style>
```

- [ ] **Step 4: Update the existing manual-FEN test (`Panel.test.ts`)**

The FEN editor is now behind the `fen-toggle`. In `Panel.test.ts`, the first test (`renders a board and a FEN input`) must open it, and the submit test must click the toggle before typing. Replace the two `it(...)` blocks with:

```typescript
  it('renders a board', () => {
    const { getByTestId } = render(Panel);
    expect(getByTestId('board')).toBeInTheDocument();
  });

  it('updates the shown FEN when the user submits one', async () => {
    const { getByTestId } = render(Panel);
    await fireEvent.click(getByTestId('fen-toggle'));
    const input = getByTestId('fen-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '8/8/8/8/8/8/8/4K2k w - - 0 1' } });
    await fireEvent.click(getByTestId('load-fen'));
    expect(getByTestId('current-fen').textContent).toContain('4K2k');
  });
```

Also add `storage: { local: { get: async () => ({}), set: async () => {} } }` to the hoisted `browser` stub in `Panel.test.ts`, `Panel.position.test.ts`, and `Panel.vision.test.ts` (the Panel now calls `hydrateSettings()` on mount). `Panel.position.test.ts` and `Panel.vision.test.ts` otherwise stay as-is: `data-testid="source"` (from SourceBadge) and `current-fen` are still present.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/ui`
Expected: PASS — Panel.test.ts, Panel.position.test.ts, Panel.vision.test.ts, Panel.states.test.ts, SourceBadge.test.ts, SettingsPanel.test.ts all green.

- [ ] **Step 6: Full type-check + commit**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

```bash
git add extension/entrypoints/sidepanel/Panel.svelte extension/src/ui/Panel.test.ts extension/src/ui/Panel.position.test.ts extension/src/ui/Panel.vision.test.ts extension/src/ui/Panel.states.test.ts
git commit -m "feat(ext): restructured panel — header, eval card, settings view, status cards"
```

---

## Task 9: Full gate + memory

- [ ] **Step 1: Run the complete suite**

Run: `npm run test`
Expected: all tests pass (baseline 34 + the new ones).

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Build both browsers**

Run: `npm run build && npm run build:firefox`
Expected: both succeed; `postbuild` prunes the duplicate ORT wasm each time.

- [ ] **Step 4: Update project memory**

Update `/home/buga/.claude/projects/-home-buga-Dev-ChessMenthol/memory/browser-extension.md`: mark Plan 3 IMPLEMENTED (list the settings surface, restructured panel, error/empty states, adapter-status signal, engine-option replay fix), note the new test count and that `app/` stays untouched, and that the **manual cross-browser gate is still pending** (now also covering: settings persistence across panel reopen, the arrows/auto-analyze/live-reading toggles, and each error state). Roadmap: Plan 4 (`packages/core` extraction) remains.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(ext): Plan 3 gate green (tests, check, both builds)"
```

---

## Self-Review (checked against the spec)

- **Spec §2 UI polish** → Task 6 (badge), Task 8 (header/eval card/controls/FEN-behind-toggle). ✓
- **Spec §2 arrows** → Task 8 `showArrows={$s.arrows}` (reused Board). ✓
- **Spec §2 settings (5 controls, persisted)** → Task 1 (store), Task 7 (UI), Task 8 (wiring). ✓
- **Spec §3.3 wiring** → Task 2 (`settingsToCommands`), Task 8 (gating for auto-analyze/live-reading). ✓
- **Spec §3.3 option-replay caveat** → Task 3 (controller applies overrides on load). ✓
- **Spec §3.4 adapter-broke** → Task 5 (`adapter-status` + `boardPresent`). ✓
- **Spec §4 panel status (priority order)** → Task 4 (`panelStatus`), Task 8 (status cards + low-confidence ribbon). ✓
- **Spec §5 storage permission** → already present in `wxt.config.ts`; noted, no task needed. ✓
- **Spec §6 testing** → each task is TDD; Task 9 is the full gate; manual gate flagged as a human follow-up. ✓
- **Type consistency:** `Settings`/`DEFAULTS` (Task 1) reused in Tasks 2/7/8; `PanelStatus` keys (Task 4) match `STATUS_TEXT` keys (Task 8); `AdapterStatusMessage` (Task 5) consumed in Task 8 `onMessage`; `settingsToCommands` return type is `Command[]` from `@core/lib/types`. ✓
- **No placeholders:** every code step is complete; commands have expected output. ✓
