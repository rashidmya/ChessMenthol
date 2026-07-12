# Browser Extension — Plan 1: Skeleton + WASM Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a cross-browser (Chrome + Firefox) WXT extension whose side panel renders the reused `Board.svelte` from a FEN and streams live Stockfish-WASM analysis (eval + best line + best-move arrow).

**Architecture:** A new top-level `extension/` WXT project imports ChessMenthol's platform-neutral modules (`core/`, `engine/`, `components/`) from `../app/src` via an `@core` path alias — **no restructure of the desktop app yet** (that is Plan 4). The Tauri native-engine backend is replaced by `wasmEngine.ts`, which implements the existing `UciEngine` seam over a Stockfish-WASM Web Worker. A `panelClient.ts` mirrors the desktop `engineClient.ts` store surface (`state`/`applyFrame`/`send`) but wires the WASM engine + the reused `Orchestrator`.

**Tech Stack:** WXT, Svelte 5 (legacy API), `stockfish.js` (nmrugg, SF18) single-threaded WASM build, Vitest + @testing-library/svelte, TypeScript. Reused as-is: `@core/core/orchestrator`, `@core/engine/{engine,session,uci,uciOptions}`, `@core/components/{Board,EvalBar,Lines}.svelte`, `@core/lib/types`.

**This plan is Plan 1 of a series.** Later plans (roadmap at the bottom): Plan 2 — board sources (tab-capture vision + DOM adapters); Plan 3 — panel UI polish + settings; Plan 4 — `packages/core` extraction.

**Scope guard — this plan does NOT include:** screen capture, vision, DOM adapters, move classification, game review, engine-options UI, or the monorepo restructure. The only way to set a position in Plan 1 is a FEN typed/pasted into the panel.

---

## File structure (created in this plan)

```
extension/
  package.json            # wxt + svelte + stockfish.js + vitest deps
  wxt.config.ts           # manifest (perms, COEP/COOP, web_accessible_resources), @core alias, svelte module
  tsconfig.json           # extends .wxt, adds @core/* path
  vitest.config.ts        # jsdom + svelte, resolves @core
  vitest-setup.ts         # @testing-library/jest-dom
  scripts/copy-engine.mjs # stage stockfish.js dist -> public/engine/
  public/engine/          # (generated) stockfish worker + wasm, web-accessible
  entrypoints/
    background.ts         # open side panel on action click
    sidepanel/
      index.html          # panel host page (cross-origin isolated)
      main.ts             # mounts Panel.svelte
      Panel.svelte        # FEN input + reused Board/EvalBar/Lines + Analyze toggle
  src/
    engine/wasmEngine.ts       # UciEngine over the stockfish.js worker
    engine/wasmEngine.test.ts
    lib/engineController.ts     # OrchestratorEngine backed by loadWasmEngine
    lib/engineController.test.ts
    lib/panelClient.ts          # stores + send() + Orchestrator wiring
    lib/panelClient.test.ts
    ui/Panel.test.ts
```

Reused desktop code is imported via `@core/*` (→ `../app/src/*`); nothing under `app/` is modified in this plan.

---

## Task 1: Scaffold the WXT + Svelte extension package

**Files:**
- Create: `extension/package.json`
- Create: `extension/wxt.config.ts`
- Create: `extension/tsconfig.json`
- Create: `extension/entrypoints/background.ts`
- Create: `extension/entrypoints/sidepanel/index.html`
- Create: `extension/entrypoints/sidepanel/main.ts`
- Create: `extension/entrypoints/sidepanel/Panel.svelte`

- [ ] **Step 1: Create `extension/package.json`**

```json
{
  "name": "chessmenthol-extension",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "postinstall": "wxt prepare",
    "copy-engine": "node scripts/copy-engine.mjs",
    "predev": "node scripts/copy-engine.mjs",
    "prebuild": "node scripts/copy-engine.mjs",
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/svelte": "^5.4.2",
    "@wxt-dev/module-svelte": "^2.0.0",
    "jsdom": "^29.1.1",
    "svelte": "^5.56.3",
    "svelte-check": "^4.6.0",
    "typescript": "~6.0.2",
    "vitest": "^4.1.9",
    "wxt": "^0.20.0"
  },
  "dependencies": {
    "@lichess-org/chessground": "^10.1.1",
    "chessops": "^0.15.0",
    "stockfish": "^18.0.8"
  }
}
```

> Note: pin `wxt`, `@wxt-dev/module-svelte`, and `stockfish` to the latest versions `npm view <pkg> version` reports at implementation time; the majors above are the expected floor. `stockfish` is the modern nmrugg Stockfish-18 WASM package (NOT `stockfish.js`, which is an ancient Stockfish-10 build). `chessops` and `@lichess-org/chessground` MUST match the versions in `app/package.json` (reused components import them).

- [ ] **Step 2: Create `extension/wxt.config.ts`**

```ts
import { defineConfig } from 'wxt';
import { resolve } from 'node:path';

// COEP/COOP make extension pages cross-origin isolated -> SharedArrayBuffer ->
// the multithreaded engine/ort builds are *available* (Plan 1 ships single-threaded,
// but keeping isolation on now avoids a manifest change later).
export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'ChessMenthol',
    description: 'Reconstructs the board on any page and analyzes it with Stockfish.',
    permissions: ['storage'],
    action: {}, // toolbar button — REQUIRED for sidePanel.setPanelBehavior({ openPanelOnActionClick }) to have something to bind to.
    // A sidepanel entrypoint makes WXT emit Chrome `side_panel` + Firefox `sidebar_action`.
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
    // Chrome MV3's DEFAULT CSP disables WebAssembly. 'wasm-unsafe-eval' lets the
    // Stockfish WASM worker compile — without this line the engine silently fails
    // to instantiate on Chrome and the panel shows no eval. (COEP/COOP above only
    // gate SharedArrayBuffer, which the single-threaded baseline doesn't use.)
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    web_accessible_resources: [
      { resources: ['engine/*'], matches: ['<all_urls>'] },
    ],
  },
  vite: () => ({
    resolve: { alias: { '@core': resolve(__dirname, '../app/src') } },
    // ort / stockfish wasm must not be pre-bundled (added in Plan 2 for ort).
    worker: { format: 'es' },
  }),
});
```

- [ ] **Step 3: Create `extension/tsconfig.json`**

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "paths": { "@core/*": ["../app/src/*"] }
  }
}
```

- [ ] **Step 4: Create `extension/entrypoints/background.ts`**

```ts
export default defineBackground({
  main() {
    // Let clicking the toolbar icon open the side panel (Chrome). On Firefox the
    // sidebar toggles via the browser action automatically.
    // @ts-expect-error sidePanel is Chrome-only; guarded at runtime.
    browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
  },
});
```

- [ ] **Step 5: Create the side-panel entrypoint (`index.html`, `main.ts`, minimal `Panel.svelte`)**

`extension/entrypoints/sidepanel/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>ChessMenthol</title></head>
  <body><div id="app"></div><script type="module" src="./main.ts"></script></body>
</html>
```

`extension/entrypoints/sidepanel/main.ts`:
```ts
import { mount } from 'svelte';
import Panel from './Panel.svelte';

mount(Panel, { target: document.getElementById('app')! });
```

`extension/entrypoints/sidepanel/Panel.svelte` (placeholder; replaced in Task 6):
```svelte
<script lang="ts">
</script>

<main><h1>ChessMenthol</h1><p>Panel loaded.</p></main>
```

- [ ] **Step 6: Install and build for both browsers**

Run:
```bash
cd extension && npm install
npm run build && npm run build:firefox
```
Expected: both builds succeed, producing `.output/chrome-mv3/` and `.output/firefox-mv2/` (or `firefox-mv3/`) with a `manifest.json`.

- [ ] **Step 7: Manual smoke — panel opens (both browsers)**

Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/.output/chrome-mv3`. Click the toolbar icon → the side panel opens showing "Panel loaded."
Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → pick `manifest.json` in `.output/firefox-*`. Click the action → the sidebar shows "Panel loaded."

- [ ] **Step 8: Commit**

```bash
git add extension
git commit -m "feat(ext): scaffold WXT + Svelte cross-browser extension with side panel"
```

---

## Task 2: Vitest + jsdom test harness in the extension package

**Files:**
- Create: `extension/vitest.config.ts`
- Create: `extension/vitest-setup.ts`
- Test: `extension/src/smoke.test.ts`

- [ ] **Step 1: Write the failing test** — `extension/src/smoke.test.ts`

```ts
import { describe, it, expect } from 'vitest';
// A *value* import (not `import type`): esbuild elides unused type-only imports,
// so a type import would pass even with NO vitest config — vacuous. A real value
// import forces vitest to actually resolve `@core` at runtime.
import { moveToUci } from '@core/lib/board';

describe('harness', () => {
  it('resolves the @core alias to reused runtime code', () => {
    expect(moveToUci('e2', 'e4')).toBe('e2e4');
    expect(moveToUci('e7', 'e8', 'q')).toBe('e7e8q');
  });
});
```

- [ ] **Step 2: Run it to verify it fails (config missing)**

Run: `cd extension && npx vitest run src/smoke.test.ts`
Expected: FAIL — cannot resolve the `@core/lib/board` value import (no vitest config / alias yet).

- [ ] **Step 3: Create `extension/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: { '@core': resolve(__dirname, '../app/src') },
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
  },
});
```

> `@sveltejs/vite-plugin-svelte` comes transitively via `@wxt-dev/module-svelte`; if `npx vitest` reports it missing, add it to devDependencies matching `app/package.json`.

- [ ] **Step 4: Create `extension/vitest-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd extension && npx vitest run src/smoke.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/vitest.config.ts extension/vitest-setup.ts extension/src/smoke.test.ts
git commit -m "test(ext): vitest + jsdom harness resolving the @core alias"
```

---

## Task 3: `wasmEngine.ts` — a `UciEngine` over the Stockfish-WASM worker

The Stockfish worker speaks UCI over `postMessage` (string in) / `onmessage` (string line out). `loadWasmEngine` wraps it as the existing `UciEngine` seam and resolves after the `uci`→`uciok` handshake, capturing advertised options via the reused `parseOptions`.

**Files:**
- Create: `extension/scripts/copy-engine.mjs`
- Create: `extension/src/engine/wasmEngine.ts`
- Test: `extension/src/engine/wasmEngine.test.ts`

- [ ] **Step 1: Write the failing test** — `extension/src/engine/wasmEngine.test.ts`

A fake worker lets us assert the seam mapping without loading real WASM.

```ts
import { describe, it, expect } from 'vitest';
import { makeWasmEngine } from './wasmEngine';

// Minimal stand-in for the Stockfish Web Worker.
class FakeWorker {
  onmessage: ((e: { data: string }) => void) | null = null;
  posted: string[] = [];
  terminated = false;
  postMessage(cmd: string) {
    this.posted.push(cmd);
    // emulate the handshake: `uci` -> option lines + `uciok`
    if (cmd === 'uci') {
      this.emit('option name Threads type spin default 1 min 1 max 512');
      this.emit('uciok');
    }
  }
  terminate() { this.terminated = true; }
  emit(line: string) { this.onmessage?.({ data: line }); }
}

describe('makeWasmEngine', () => {
  it('resolves after uciok and captures advertised options', async () => {
    const w = new FakeWorker();
    const engine = await makeWasmEngine(w as unknown as Worker);
    expect(w.posted).toContain('uci');
    expect(engine.options?.some((o) => o.name === 'Threads')).toBe(true);
  });

  it('routes worker lines to onLine and forwards send()', async () => {
    const w = new FakeWorker();
    const engine = await makeWasmEngine(w as unknown as Worker);
    const lines: string[] = [];
    engine.onLine((l) => lines.push(l));
    engine.send('go depth 1');
    expect(w.posted).toContain('go depth 1');
    w.emit('info depth 1 score cp 12 pv e2e4');
    expect(lines).toContain('info depth 1 score cp 12 pv e2e4');
  });

  it('dispose() terminates the worker and is idempotent', async () => {
    const w = new FakeWorker();
    const engine = await makeWasmEngine(w as unknown as Worker);
    engine.dispose();
    engine.dispose();
    expect(w.terminated).toBe(true);
  });

  it('rejects and disposes the worker on a handshake timeout', async () => {
    const w = new FakeWorker();
    w.postMessage = (cmd: string) => { w.posted.push(cmd); }; // never answers `uci`
    await expect(makeWasmEngine(w as unknown as Worker, 1)).rejects.toThrow('handshake timed out');
    expect(w.terminated).toBe(true); // no zombie worker on a failed load
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd extension && npx vitest run src/engine/wasmEngine.test.ts`
Expected: FAIL — `./wasmEngine` has no `makeWasmEngine`.

- [ ] **Step 3: Implement `extension/src/engine/wasmEngine.ts`**

```ts
// `browser` is not auto-imported in plain src/ modules (only in WXT entrypoints),
// so import it explicitly. `PublicPath` is WXT's getURL path type.
import { browser, type PublicPath } from 'wxt/browser';
import type { UciEngine } from '@core/engine/engine';
import { parseOptions } from '@core/engine/uciOptions';

/**
 * Wrap an already-constructed Stockfish Web Worker as a UciEngine. Split out
 * from loadWasmEngine() so tests can inject a fake worker (no real WASM).
 * Resolves once the engine answers `uciok`; the option lines seen during the
 * handshake become `engine.options`.
 */
export function makeWasmEngine(worker: Worker, timeoutMs = 10_000): Promise<UciEngine> {
  const listeners: ((line: string) => void)[] = [];
  const optionLines: string[] = [];
  let handshakeDone = false;

  worker.onmessage = (e: MessageEvent) => {
    const line = String((e as MessageEvent<string>).data).trim();
    if (!line) return;
    if (!handshakeDone && line.startsWith('option name ')) optionLines.push(line);
    for (const cb of listeners) cb(line);
  };

  const engine: UciEngine = {
    send: (cmd) => worker.postMessage(cmd),
    onLine: (cb) => { listeners.push(cb); },
    dispose: () => { worker.onmessage = null; worker.terminate(); },
  };

  return new Promise<UciEngine>((resolve, reject) => {
    // Dispose before rejecting so a handshake timeout doesn't leak a zombie Worker
    // (a failed loadWasmEngine() may be retried by the engine controller).
    const timer = setTimeout(() => { engine.dispose(); reject(new Error('engine handshake timed out')); }, timeoutMs);
    listeners.push((line) => {
      if (line === 'uciok' && !handshakeDone) {
        handshakeDone = true;
        clearTimeout(timer);
        engine.options = parseOptions(optionLines);
        resolve(engine);
      }
    });
    worker.postMessage('uci');
  });
}

// Stockfish 18 "lite" (small NNUE) "single"-threaded build: the Plan-1 baseline —
// no SharedArrayBuffer required, runs in Chrome and Firefox everywhere. Staged by
// copy-engine.mjs (Step 5). Leading slash: browser.runtime.getURL resolves it
// against the extension root, where WXT serves public/.
const SF_WORKER_URL = '/engine/stockfish-18-lite-single.js';

/** Construct the real Stockfish worker from the web-accessible resource. */
export function loadWasmEngine(): Promise<UciEngine> {
  // Cast: PublicPath is a closed union of WXT entrypoint outputs and excludes our
  // own copy-engine.mjs-staged /engine/* files, so assert through it.
  const url = browser.runtime.getURL(SF_WORKER_URL as PublicPath);
  const worker = new Worker(url, { type: 'classic' });
  return makeWasmEngine(worker);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd extension && npx vitest run src/engine/wasmEngine.test.ts`
Expected: PASS (3 tests). `loadWasmEngine` is untested here — it needs the browser runtime + real worker (covered by the manual gate in Task 6).

- [ ] **Step 5: Create `extension/scripts/copy-engine.mjs` and stage the engine**

```js
// Stage the Stockfish 18 lite single-threaded build into public/engine/ as
// web-accessible resources (CSP-safe: loaded via a bundled Worker URL, never
// eval'd). "lite" = small NNUE net; "single" = no threads / no SharedArrayBuffer,
// so it runs in Chrome and Firefox with no cross-origin-isolation requirement.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'node_modules', 'stockfish', 'bin');
const dest = join(here, '..', 'public', 'engine');
mkdirSync(dest, { recursive: true });

// The .js is emscripten glue that loads the sibling .wasm from the same dir, so
// both must be staged together.
const files = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];
for (const f of files) cpSync(join(src, f), join(dest, f));
console.log(`[copy-engine] staged ${files.length} file(s) -> public/engine/`, files);
```

First swap the engine dependency — Task 1 installed the wrong, ancient `stockfish.js@10`:
`cd extension && npm uninstall stockfish.js && npm install stockfish@^18.0.8`. Then run
`node scripts/copy-engine.mjs` and confirm it prints the two staged files and that
`public/engine/stockfish-18-lite-single.{js,wasm}` now exist. `SF_WORKER_URL` in
`wasmEngine.ts` already points at `/engine/stockfish-18-lite-single.js`; the wrapper only
needs a Worker whose `postMessage('uci')` yields `uciok` (verified end-to-end by the Task 6
manual gate — the real WASM can't run in jsdom).

- [ ] **Step 6: Run all extension tests + type-check**

Run: `cd extension && npx vitest run && npm run check`
Expected: all tests PASS; svelte-check reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add extension/src/engine extension/scripts/copy-engine.mjs
git commit -m "feat(ext): wasmEngine implementing the UciEngine seam over Stockfish WASM"
```

---

## Task 4: Extension `engineController` (OrchestratorEngine)

Mirror the desktop `engineController` (an `OrchestratorEngine`) but load the WASM engine and drop the `isTauri()` guard, engine registry, and multi-engine switching (single bundled engine in Plan 1).

**Files:**
- Create: `extension/src/lib/engineController.ts`
- Test: `extension/src/lib/engineController.test.ts`

- [ ] **Step 1: Write the failing test** — `extension/src/lib/engineController.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { createEngineController } from './engineController';
import type { UciEngine } from '@core/engine/engine';

function fakeEngine(): UciEngine {
  return { send: vi.fn(), onLine: vi.fn(), dispose: vi.fn(), options: [] };
}

describe('createEngineController', () => {
  it('loads the engine once and caches it', async () => {
    const load = vi.fn(async () => fakeEngine());
    const ctrl = createEngineController(load);
    const a = await ctrl.ensureEngine();
    const b = await ctrl.ensureEngine();
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    expect(ctrl.currentEngine()).toBe(a);
  });

  it('setOption forwards to the live engine and is a no-op before load', () => {
    const ctrl = createEngineController(async () => fakeEngine());
    ctrl.setOption('Threads', '2'); // no engine yet -> no throw
    expect(ctrl.currentEngine()).toBeNull();
  });

  it('dispose() releases the engine and lets it reload', async () => {
    const load = vi.fn(async () => fakeEngine());
    const ctrl = createEngineController(load);
    const first = await ctrl.ensureEngine();
    ctrl.dispose();
    expect(ctrl.currentEngine()).toBeNull();
    const second = await ctrl.ensureEngine();
    expect(second).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd extension && npx vitest run src/lib/engineController.test.ts`
Expected: FAIL — `./engineController` has no `createEngineController`.

- [ ] **Step 3: Implement `extension/src/lib/engineController.ts`**

```ts
import type { UciEngine } from '@core/engine/engine';
import type { OrchestratorEngine } from '@core/core/orchestrator';
import { formatSetOption } from '@core/engine/uciOptions';

export type EngineLoader = () => Promise<UciEngine>;

/**
 * The OrchestratorEngine for the extension: one WASM engine, loaded lazily and
 * cached. Simpler than the desktop controller (no registry / multi-engine swap).
 */
export function createEngineController(load: EngineLoader): OrchestratorEngine & {
  // Re-declared as required (OrchestratorEngine declares them optional) so callers
  // can invoke them without a `?.` guard — intersecting with a required signature
  // de-optionalizes them. Without this the test's `ctrl.setOption(...)` call is a
  // svelte-check error ("possibly undefined").
  select(id?: string): void;
  setOption(name: string, value?: string): void;
  ensureEngine(): Promise<UciEngine>;
  currentEngine(): UciEngine | null;
  dispose(): void;
} {
  let engine: UciEngine | null = null;
  let loadPromise: Promise<UciEngine> | null = null;

  return {
    // `select` is part of OrchestratorEngine but there is only one engine here.
    select() {},
    setOption(name: string, value?: string) {
      if (!engine) return;
      engine.send(formatSetOption(name, value));
    },
    ensureEngine() {
      if (!loadPromise) {
        const p = load().then((e) => { engine = e; return e; });
        loadPromise = p;
        p.catch(() => { if (loadPromise === p) loadPromise = null; });
      }
      return loadPromise;
    },
    currentEngine() { return engine; },
    dispose() {
      engine?.dispose();
      engine = null;
      loadPromise = null;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd extension && npx vitest run src/lib/engineController.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/engineController.ts extension/src/lib/engineController.test.ts
git commit -m "feat(ext): WASM-backed OrchestratorEngine controller"
```

---

## Task 5: `panelClient.ts` — stores + `send()` + Orchestrator wiring

Mirror the desktop `engineClient.ts` store surface, wiring the reused `Orchestrator` to the WASM engine controller and a `LazySession` (reusing `AnalysisSession`). No tracker in Plan 1 (vision arrives in Plan 2).

**Files:**
- Create: `extension/src/lib/panelClient.ts`
- Test: `extension/src/lib/panelClient.test.ts`

- [ ] **Step 1: Write the failing test** — `extension/src/lib/panelClient.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { createPanelClient } from './panelClient';
import type { UciEngine } from '@core/engine/engine';

// An engine that answers `go` with one info + bestmove so a real AnalysisSession runs.
// It MUST reply asynchronously: AnalysisSession.launch() sends `go` and only THEN sets
// phase='searching', and handleLine ignores info/bestmove unless phase==='searching'.
// A synchronous reply inside send() would be dropped (phase still 'idle'); queueMicrotask
// defers the reply until after launch() returns.
function scriptedEngine(): UciEngine {
  let onLine: ((l: string) => void) | null = null;
  return {
    send(cmd: string) {
      if (cmd.startsWith('go')) {
        queueMicrotask(() => {
          onLine?.('info depth 10 multipv 1 score cp 30 pv e2e4 e7e5');
          onLine?.('bestmove e2e4');
        });
      }
    },
    onLine(cb) { onLine = cb; },
    dispose() {},
    options: [],
  };
}

describe('createPanelClient', () => {
  it('set_fen + enable analysis produces a StateFrame with best lines', async () => {
    const client = createPanelClient(async () => scriptedEngine());
    client.send({ type: 'set_fen', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' });
    client.send({ type: 'set_analysis_enabled', enabled: true });
    // Let the async engine load + search settle. StateFrame carries `lines` directly.
    await vi.waitFor(() => {
      const s = get(client.state);
      expect(s?.lines?.length ?? 0).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd extension && npx vitest run src/lib/panelClient.test.ts`
Expected: FAIL — `./panelClient` has no `createPanelClient`.

- [ ] **Step 3: Implement `extension/src/lib/panelClient.ts`**

```ts
import { writable } from 'svelte/store';
import { Orchestrator, type SessionLike } from '@core/core/orchestrator';
import { AnalysisSession, type SessionCallbacks, type StartOptions } from '@core/engine/session';
import type { UciEngine } from '@core/engine/engine';
import type { Command, ServerFrame, StateFrame } from '@core/lib/types';
import { createEngineController, type EngineLoader } from './engineController';

/**
 * The extension's port of engineClient.ts: the same command->frame->store surface,
 * wiring the reused Orchestrator to the WASM engine. No Tauri, no vision tracker
 * (Plan 2 adds a browser tracker), no engine registry.
 */
export function createPanelClient(load: EngineLoader) {
  const state = writable<StateFrame | null>(null);
  const lastError = writable<string | null>(null);

  function applyFrame(frame: ServerFrame): void {
    if (frame.type === 'state') state.set(frame);
    else if (frame.type === 'error') lastError.set(frame.message);
  }

  const engineController = createEngineController(load);

  // LazySession: build the real AnalysisSession on the first start(), rebinding
  // if the engine is (re)loaded. Ported from engineClient.ts's LazySession.
  class LazySession implements SessionLike {
    private real: AnalysisSession | null = null;
    private bound: UciEngine | null = null;
    private pending: { fen: string; opts: StartOptions } | null = null;
    private loading = false;
    constructor(private cb: SessionCallbacks) {}
    start(fen: string, opts: StartOptions): void {
      const live = engineController.currentEngine();
      if (this.real && live && live === this.bound) { this.real.start(fen, opts); return; }
      this.pending = { fen, opts };
      if (!this.loading) {
        this.loading = true;
        engineController.ensureEngine().then((engine) => {
          this.real = new AnalysisSession(engine, this.cb);
          this.bound = engine;
          this.loading = false;
          const p = this.pending; this.pending = null;
          if (p) this.real.start(p.fen, p.opts);
        }).catch((err) => {
          this.loading = false;
          applyFrame({ type: 'error', message: `engine failed to load: ${err}` });
        });
      }
    }
    stop(): void { if (this.real) this.real.stop(); else this.pending = null; }
    dispose(): void { this.real?.dispose(); }
  }

  const orch = new Orchestrator(applyFrame, {
    engine: engineController,
    sessionFactory: (_engine, cb) => new LazySession(cb),
  });
  orch.handle({ type: 'navigate', index: 0 }); // seed the initial frame

  return {
    state,
    lastError,
    send(cmd: Command): void { orch.handle(cmd); },
  };
}
```

> Import sources (verified against the reused modules): `Orchestrator`/`SessionLike` from `@core/core/orchestrator`; `AnalysisSession`/`SessionCallbacks`/`StartOptions` from `@core/engine/session`; `UciEngine` from `@core/engine/engine`; `orch.handle(cmd)` is the public command entry (`core/orchestrator.ts:209`). `StateFrame` carries `lines`/`eval`/`analyzing` directly — there is no `.analysis` sub-object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd extension && npx vitest run src/lib/panelClient.test.ts`
Expected: PASS. If `StartOptions`/`SessionCallbacks` names differ, correct the imports (Step 3 note) and re-run.

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/panelClient.ts extension/src/lib/panelClient.test.ts
git commit -m "feat(ext): panelClient wiring the reused Orchestrator to the WASM engine"
```

---

## Task 6: `Panel.svelte` — FEN input + reused board + live analysis

**Files:**
- Modify: `extension/entrypoints/sidepanel/Panel.svelte`
- Test: `extension/src/ui/Panel.test.ts`

- [ ] **Step 1: Write the failing test** — `extension/src/ui/Panel.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Panel from '../../entrypoints/sidepanel/Panel.svelte';

describe('Panel', () => {
  it('renders a board and a FEN input', () => {
    const { getByTestId } = render(Panel);
    expect(getByTestId('fen-input')).toBeInTheDocument();
    expect(getByTestId('board')).toBeInTheDocument();
  });

  it('updates the shown FEN when the user submits one', async () => {
    const { getByTestId } = render(Panel);
    const input = getByTestId('fen-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '8/8/8/8/8/8/8/4K2k w - - 0 1' } });
    await fireEvent.click(getByTestId('load-fen'));
    expect(getByTestId('current-fen').textContent).toContain('4K2k');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd extension && npx vitest run src/ui/Panel.test.ts`
Expected: FAIL — Panel has no such testids.

- [ ] **Step 3: Implement `extension/entrypoints/sidepanel/Panel.svelte`**

```svelte
<script lang="ts">
  import Board from '@core/components/Board.svelte';
  import EvalBar from '@core/components/EvalBar.svelte';
  import Lines from '@core/components/Lines.svelte';
  import { createPanelClient } from '../../src/lib/panelClient';
  import { loadWasmEngine } from '../../src/engine/wasmEngine';

  // In a jsdom test the real worker never loads; createPanelClient only calls
  // load() when analysis is enabled, so mounting stays engine-free.
  const client = createPanelClient(loadWasmEngine);
  // Named panelState (not `state`) so `$panelState` isn't confused with Svelte 5's
  // `$state` rune — this file is on the legacy API.
  const panelState = client.state;
  const lastError = client.lastError; // engine/load failures (e.g. a wasm CSP block)

  let fenInput = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let currentFen = fenInput;
  let analyzing = false;
  // Plan 1's only position source is the FEN input. Board is draggable by default;
  // bumping revertSignal on any drag makes it snap back to currentFen (no make_move).
  let revertSignal = 0;

  function loadFen() {
    currentFen = fenInput.trim();
    client.send({ type: 'set_fen', fen: currentFen });
    if (analyzing) client.send({ type: 'set_analysis_enabled', enabled: true });
  }
  function toggleAnalysis() {
    analyzing = !analyzing;
    client.send({ type: 'set_analysis_enabled', enabled: analyzing });
  }

  // StateFrame carries eval/lines directly (there is no `.analysis`). Board
  // orientation is fixed to White in Plan 1 (vision-driven orientation is Plan 2).
  const orientation: 'white' | 'black' = 'white';
  $: evalDto = $panelState?.eval ?? null;
  $: lines = $panelState?.lines ?? [];
</script>

<main class="panel">
  <div class="board-row">
    <EvalBar {evalDto} {orientation} />
    <!-- Board.svelte renders its own <div data-testid="board">; don't wrap it in a
         second one or getByTestId('board') matches two elements. onMove+revertSignal
         discard any drag so the FEN input stays the only position source (Plan 1). -->
    <Board fen={currentFen} {orientation} {lines} onMove={() => { revertSignal += 1; }} {revertSignal} />
  </div>

  <div class="controls">
    <input data-testid="fen-input" bind:value={fenInput} placeholder="Paste a FEN" />
    <button data-testid="load-fen" on:click={loadFen}>Load</button>
    <button data-testid="analyze" on:click={toggleAnalysis}>{analyzing ? 'Stop' : 'Analyze'}</button>
  </div>

  <p data-testid="current-fen" class="fen">{currentFen}</p>
  {#if $lastError}<p class="err" data-testid="panel-error">{$lastError}</p>{/if}
  <Lines {lines} />
</main>

<style>
  .panel { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .board-row { display: flex; gap: 6px; }
  .controls { display: flex; gap: 6px; }
  .controls input { flex: 1; }
  .fen { font: 11px/1.3 monospace; color: #888; word-break: break-all; }
  .err { margin: 0; color: #c33; font-size: 12px; }
</style>
```

> Verified props: `EvalBar` expects `evalDto: EvalDto | null` + `orientation` (plus optional `gameOver`/`horizontal`); `Lines` expects `lines: LineDto[]`; `Board` takes `fen`/`orientation`/`lines`/`lastMove`/`showArrows` (best-move arrow on by default).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd extension && npx vitest run src/ui/Panel.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite + type-check + build**

Run:
```bash
cd extension && npx vitest run && npm run check && npm run build && npm run build:firefox
```
Expected: all tests PASS, 0 svelte-check errors, both browser builds succeed.

- [ ] **Step 6: Manual cross-browser gate (human)** — the Plan 1 milestone

Load unpacked in **Chrome** and temporary add-on in **Firefox** (Task 1 Step 7). In each:
1. Open the side panel; the starting position renders on the reused board.
2. Paste a mid-game FEN, click **Load** → the board updates.
3. Click **Analyze** → within a second the eval bar moves, best line(s) appear under the board, and the best-move arrow is drawn. Click **Stop** → streaming halts.

Record the result (pass / issues) before proceeding to Plan 2.

- [ ] **Step 7: Commit**

```bash
git add extension/entrypoints/sidepanel/Panel.svelte extension/src/ui/Panel.test.ts
git commit -m "feat(ext): side-panel UI with FEN input, reused board, and live WASM analysis"
```

---

## Self-review notes (author)

- **Spec coverage (Plan 1 slice):** side-panel UI ✓ (Task 6), WASM engine behind `UciEngine` ✓ (Task 3), cross-origin isolation for the multithreaded upgrade path ✓ (Task 1 manifest), single-threaded baseline ✓ (Task 3 `SF_WORKER_URL`), cross-browser Chrome+Firefox ✓ (build + manual gate), reuse-via-alias (no restructure) ✓. Deferred spec items (capture, vision, adapters, classification, `packages/core`) are explicitly out of this plan's scope and mapped to Plans 2–4 below.
- **Placeholder scan:** the only deliberately deferred concrete value is `SF_WORKER_URL`, isolated to one line and verified by the Task 3 handshake test + Task 6 manual gate (the package's exact build filename is discovered by `copy-engine.mjs`, not guessable up front). Every code step ships complete code.
- **Type consistency:** `UciEngine`, `OrchestratorEngine`, `OrchestratorOptions`, `Command`, `StateFrame` names are taken verbatim from the reused modules; `EngineLoader`/`createEngineController`/`createPanelClient`/`makeWasmEngine`/`loadWasmEngine` are used consistently across tasks. Two notes (Task 5 Step 3, Task 6 Step 3) flag imported names to confirm against source before running — grep-and-fix, not invent.

---

## Roadmap — remaining plans (written as each phase lands)

- **Plan 2 — Board sources:** `TabCapturer` (`browser.tabs.captureVisibleTab` → `RgbaImage`) feeding the reused vision worker (on-demand capture button); `SiteAdapter` interface + chess.com & lichess DOM adapters with `MutationObserver`-driven live updates; source auto-select (DOM where matched, vision fallback). Adds `onnxruntime-web` + the ONNX assets copy step; content-script entrypoints + `host_permissions` + `activeTab`.
- **Plan 3 — Panel UI polish + settings:** eval-bar/best-line/arrow styling for the narrow panel, source toggle + status, depth/threads settings (persisted via `storage`), error/empty states, and the full cross-browser manual gate.
- **Plan 4 — `packages/core` extraction:** convert the repo to an npm workspace, move the platform-neutral modules into `packages/core` (keeping the ~580 desktop tests green), and re-point both `app/` and `extension/` at the shared package — retiring the `@core` → `../app/src` alias.
```
