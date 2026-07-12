# Plan 4 — `packages/core` monorepo extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the code shared by the desktop app and the browser extension into a real
npm-workspace package `@chessmenthol/core`, retiring the `@core → ../app/src` alias and the
extension's `@tauri-apps/api` devDependency, with both test suites green at every task.

**Architecture:** Add root npm workspaces (`packages/*`, `app`, `extension`). `@chessmenthol/core`
is **TS-only, source-only** (no build; consumers' bundlers compile its `.ts` via subpath exports
`{ "./*": "./src/*.ts" }`). The physical move is done atomically with **re-export shims** left at
every old `app/src` path, so app + extension keep resolving; consumers are then repointed to the
package and the shims deleted. Two Tauri-coupled files (`capture.ts`, `engineOptions.ts`) are split
first so nothing portable drags `@tauri-apps/api`. The 4 shared Svelte components
(`Board`/`EvalBar`/`Lines`/`Icon`) stay in `app/` and are **duplicated** into the extension (core
is TS-only). Core-owned tests migrate into the package.

**Tech Stack:** npm workspaces, TypeScript (bundler module resolution), Vite (app), WXT/Rollup
(extension), Vitest (jsdom) in all three packages, Svelte 5 legacy API.

**Design:** `docs/superpowers/specs/2026-07-12-browser-extension-4-packages-core-extraction-design.md`

---

## Conventions used throughout

- **Working dir:** repo root `/home/buga/Dev/ChessMenthol/.claude/worktrees/browser-extension`
  unless a step says otherwise.
- **Commit trailer** (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **Docs are gitignored-but-tracked:** this plan and the design were added with `git add -f`.
- **Do NOT push until Task 6 lands.** CI (`ci.yml`) triggers on `push` to `feat/**` and reads
  `app/package-lock.json`; intermediate commits would fail CI until Task 6 fixes the workflows.
- **The package import specifier is** `@chessmenthol/core/<dir>/<file>` (e.g.
  `@chessmenthol/core/core/chess`, `@chessmenthol/core/lib/types`, `@chessmenthol/core/vision/tracker`).
- **Shim template** (a file left at an old `app/src` path after its real content moved to core):
  ```ts
  // TEMPORARY re-export shim (Plan 4) — deleted in Task 5. Real module: @chessmenthol/core/<dir>/<file>
  export * from '@chessmenthol/core/<dir>/<file>';
  ```
  If (and only if) the moved module has a `default` export, also add
  `export { default } from '@chessmenthol/core/<dir>/<file>';`. (None of the 29 moved TS modules
  has a default export — verify with the grep in Task 3, Step 8.)

### The move set (locked — used by Tasks 3–5)

**29 source modules move** to `packages/core/src/<dir>/<file>` (subdir preserved):
- `core/`: `accuracy chess classify orchestrator pgn report serialize` (7)
- `engine/`: `engine session types uci uciOptions` (5 — **not** `nativeEngine`)
- `vision/`: `coords detect pieces position tracker types visionClient` (7 — **not** `vision-worker`)
- `lib/`: `arrows board edit engineOptions engineRegistry evalbar image licon region types` (10 —
  where `image` and the reduced `engineOptions` are produced by Task 2)

**Stay in `app/src`:** `lib/{capture engineSchema engineClient glyphs moveclass options squareCorner
viewport viewprefs}`, `engine/nativeEngine`, `vision/vision-worker`, all `components/*`,
`App.svelte`, `main.ts`, `app.css`. (`capture` = the Tauri `Capturer`; `engineSchema` = the
`ensureSchema` probe — both created by Task 2.)

**34 test files migrate** to `packages/core/src/tests/` (+ the `fixtures/` dir + `visionFixtures.ts`):
`accuracy arrows classify coords coreChess detect edit editorPgn engineOptionsStore engineRegistry
engineTypes lastMove legalMoves moveToUci orchestrator orchestratorAnnotate orchestratorEvalCache
orchestratorReport pgn pieces position promotion region report reportClassify serialize session
tracker uci uciOptions visionClient visionTypes whitePct` `.test.ts`, plus `capture.test.ts`
(→ tests `../lib/image`; see Task 3 Step 6) and helper `visionFixtures.ts` + `fixtures/`.

**Tests stay in `app/src/tests`:** all component tests (`Board EvalBar Lines Icon App Panel
AccuracyDial ActionBar BoardBadge BoardControls BoardTurnColor EditPalette EditPanel EngineHeader
EngineList EngineOptions EngineSettings EvalGraph GameReportSummary HomePanel MoveBadge MoveFeedback
MoveHistory MoveStepper RangeSlider RegionOverlay Switch Titlebar TurnToggle ViewMenu WindowResize`
+ `PanelHarness.svelte`), the Tauri/integration tests (`engineClient engineClientNative nativeEngine
fetch-sidecar smoke`), and the desktop-only lib tests (`glyphs moveclass options squareCorner viewport
viewprefs`).

---

## Task 1: Scaffold the workspace + prove source-only resolution

**Files:**
- Create: `package.json` (repo root)
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`,
  `packages/core/vitest.config.ts`, `packages/core/vitest-setup.ts`,
  `packages/core/src/_probe.ts` (throwaway, deleted at end of task)
- Delete: `app/package-lock.json`, `extension/package-lock.json`
- Modify: `app/src/main.ts` (temporary probe import, reverted), `extension/entrypoints/sidepanel/main.ts` (temporary probe import, reverted)

- [ ] **Step 1: Baseline green.** Confirm the starting point before any change.

Run:
```bash
( cd app && npm test >/tmp/app-base.log 2>&1; tail -3 /tmp/app-base.log )
( cd extension && npx vitest run >/tmp/ext-base.log 2>&1; tail -3 /tmp/ext-base.log )
```
Expected: app ~580 passed; extension 56 passed.

- [ ] **Step 2: Root workspace manifest.** Create `package.json`:

```json
{
  "name": "chessmenthol-monorepo",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["packages/*", "app", "extension"]
}
```

- [ ] **Step 3: Package manifest.** Create `packages/core/package.json`:

```json
{
  "name": "@chessmenthol/core",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { "./*": "./src/*.ts" },
  "scripts": {
    "test": "vitest run",
    "check": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "chessops": "^0.15.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "jsdom": "^29.1.1",
    "typescript": "~6.0.2",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 4: Package tsconfig.** Create `packages/core/tsconfig.json` (mirrors the strict/bundler
settings the moved code was already type-checked under):

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2023", "dom", "dom.iterable"],
    "types": ["vitest/globals"],
    "strict": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 5: Package vitest config + setup.** Create `packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
  },
});
```

Create `packages/core/vitest-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: Probe module + throwaway importers.** Create `packages/core/src/_probe.ts`:

```ts
export const PROBE = 'chessmenthol-core-ok' as const;
```

Add, as the FIRST line of `app/src/main.ts`:
```ts
import { PROBE } from '@chessmenthol/core/_probe'; if (PROBE) { /* Plan4 probe */ }
```
Add the same first line to `extension/entrypoints/sidepanel/main.ts`.

- [ ] **Step 7: Install workspaces + single lockfile.**

Run:
```bash
git rm --quiet app/package-lock.json extension/package-lock.json
rm -rf app/node_modules extension/node_modules node_modules
npm install
ls -d node_modules/@chessmenthol/core
```
Expected: install succeeds; a root `package-lock.json` exists; `node_modules/@chessmenthol/core`
is a symlink to `packages/core`.

- [ ] **Step 8: Prove resolution in every toolchain.**

Run:
```bash
( cd app && npx tsc -p tsconfig.app.json --noEmit 2>&1 | tail -5 )
( cd app && npx svelte-check --tsconfig ./tsconfig.app.json 2>&1 | tail -3 )
( cd app && npx vite build 2>&1 | tail -5 )
( cd extension && npm run check 2>&1 | tail -3 )
( cd extension && npx wxt build 2>&1 | tail -5 )
```
Expected: all succeed — the `@chessmenthol/core/_probe` import resolves under app tsc, app
svelte-check, app vite build, extension svelte-check, and WXT build.

**If app svelte-check/tsc fails to resolve the package's `.ts` types:** change
`packages/core/package.json` `exports` to the explicit-conditions form and re-run:
```json
"exports": { "./*": { "types": "./src/*.ts", "default": "./src/*.ts" } }
```

- [ ] **Step 9: Revert the probe.** Remove the probe import line from both `main.ts` files; delete
`packages/core/src/_probe.ts`.

Run:
```bash
git checkout app/src/main.ts extension/entrypoints/sidepanel/main.ts
rm packages/core/src/_probe.ts
```

- [ ] **Step 10: Verify suites still green.**

Run:
```bash
( cd app && npm test 2>&1 | tail -3 )
( cd extension && npx vitest run 2>&1 | tail -3 )
```
Expected: app ~580 passed; extension 56 passed. (`packages/core` has no tests yet.)

- [ ] **Step 11: Commit.**

```bash
git add -A
git add -f docs/superpowers/plans/2026-07-12-browser-extension-4-packages-core-extraction.md
git commit -m "chore(core): scaffold @chessmenthol/core workspace package

Root npm workspaces; @chessmenthol/core is TS-only, source-only
(exports ./* -> ./src/*.ts). Single root lockfile. Proved the package
resolves under app tsc/svelte-check/vite and extension check/wxt build
via a throwaway probe (reverted). No shared code moved yet.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Split the two Tauri-coupled files in place

Splits happen **inside `app/src/lib`** (no move yet) so the pure halves become free-standing,
Tauri-free modules ready to move in Task 3.

**Files:**
- Create: `app/src/lib/image.ts`, `app/src/lib/engineSchema.ts`
- Modify: `app/src/lib/capture.ts`, `app/src/lib/engineOptions.ts`
- Modify: importers of the moved symbols (found by grep in the steps)

- [ ] **Step 1: Create `app/src/lib/image.ts`** with the pure image utilities lifted verbatim from
`capture.ts`:

```ts
// app/src/lib/image.ts
// Pure, structured-clone-safe RGBA image helpers (no Tauri). Split out of capture.ts so the
// browser extension can reuse them without dragging @tauri-apps/api.
import type { Region } from './region';

/** Plain-data RGBA image; structured-clone safe for the vision worker. */
export interface RgbaImage {
  data: Uint8ClampedArray; // RGBA, length === width*height*4
  width: number;
  height: number;
}

/** Decode the [width u32 LE][height u32 LE][RGBA...] buffer from capture_frame. */
export function decodeCaptureBuffer(buf: ArrayBuffer): RgbaImage {
  const v = new DataView(buf);
  const width = v.getUint32(0, true);
  const height = v.getUint32(4, true);
  const data = new Uint8ClampedArray(buf.slice(8));
  return { data, width, height };
}

/** Crop an RGBA image to a region, clamped to the image bounds. */
export function cropImage(src: RgbaImage, region: Region): RgbaImage {
  const left = Math.max(0, Math.min(region.left, src.width));
  const top = Math.max(0, Math.min(region.top, src.height));
  const width = Math.max(0, Math.min(region.width, src.width - left));
  const height = Math.max(0, Math.min(region.height, src.height - top));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcStart = ((top + y) * src.width + left) * 4;
    out.set(src.data.subarray(srcStart, srcStart + width * 4), y * width * 4);
  }
  return { data: out, width, height };
}
```

- [ ] **Step 2: Reduce `app/src/lib/capture.ts`** to the Tauri surface, re-importing the pure
helpers:

```ts
// app/src/lib/capture.ts
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Region } from './region';
import { cropImage, decodeCaptureBuffer, type RgbaImage } from './image';

export type { RgbaImage };

/** True when the native capture command is available (running inside Tauri). */
export function hasNativeCapture(): boolean {
  return isTauri();
}

/** The main-thread screen capturer: grabs the full desktop and crops to a region. */
export class Capturer {
  private region: Region | null = null;

  setRegion(region: Region | null): void {
    this.region = region;
  }

  async grabFullDesktop(): Promise<RgbaImage> {
    const buf = (await invoke('capture_frame')) as ArrayBuffer;
    return decodeCaptureBuffer(buf);
  }

  /** Full desktop cropped to the active region (or the whole frame if unset). */
  async grab(): Promise<RgbaImage> {
    const full = await this.grabFullDesktop();
    return this.region === null ? full : cropImage(full, this.region);
  }
}
```
Note: `capture.ts` re-exports `RgbaImage` so existing `import { type RgbaImage } from '../lib/capture'`
sites keep compiling until Task 3/4 repoints them.

- [ ] **Step 3: Repoint the extension's image importers** from `@core/lib/capture` to
`@core/lib/image` (still via the `@core` alias — that changes to the package in Task 5).

Find:
```bash
grep -rn "@core/lib/capture" extension --include='*.ts' --include='*.svelte'
```
For every hit that imports `cropImage` / `decodeCaptureBuffer` / `RgbaImage`, change the specifier
to `@core/lib/image`. (Per recon these are: `extension/src/lib/tabCapturer.ts:1`,
`tabCapturer.test.ts:3`, `visionTracker.ts:3`, `visionTracker.test.ts:3`, `vision-worker.ts:5`.)

Verify none remain pointing at capture for image symbols:
```bash
grep -rn "@core/lib/capture" extension --include='*.ts' --include='*.svelte' || echo "clean"
```
Expected: `clean` (the extension uses none of capture's Tauri surface).

- [ ] **Step 4: Repoint app image importers** from `'../lib/capture'` / `'./capture'` to `image`,
**only** where the imported symbols are `cropImage` / `decodeCaptureBuffer` / `RgbaImage`.

Find:
```bash
grep -rn "lib/capture'\|'./capture'\|/capture'" app/src --include='*.ts' --include='*.svelte'
```
Repoint the image-symbol importers (per recon: `serialize.ts`, `orchestrator.ts`,
`visionClient.ts`, `vision/types.ts`, and test `capture.test.ts` — but leave `capture.test.ts`
until Task 3 Step 6). Leave any `Capturer`/`hasNativeCapture` importer (e.g. `engineClient.ts`,
`RegionOverlay`) pointing at `../lib/capture`.

- [ ] **Step 5: Create `app/src/lib/engineSchema.ts`** with `ensureSchema` moved out of
`engineOptions.ts` verbatim:

```ts
// app/src/lib/engineSchema.ts
// The Tauri-only half of engine options: probe a native engine for its UCI option schema.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { parseOptions } from '../engine/uciOptions';
import { get as getEngineRecord } from './engineRegistry';
import { getSchema, setSchema } from './engineOptions';
import type { UciOption } from '../engine/uciOptions';

/** Ensure a schema is cached for `id`; probe via Tauri if missing. Never throws.
 *  In a plain browser there is no native engine (analysis is desktop-only), so we
 *  return []. Desktop always has engine_probe, satisfying "options available before analysis". */
export async function ensureSchema(id: string): Promise<UciOption[]> {
  const cached = getSchema(id);
  if (cached) return cached;
  const rec = getEngineRecord(id);
  if (!rec || !isTauri()) return [];
  try {
    const spec = rec.kind === 'external' && rec.path
      ? { kind: 'external', path: rec.path }
      : { kind: 'bundled' };
    const { option_lines } = await invoke<{ name: string; option_lines: string[] }>('engine_probe', { spec });
    const schema = parseOptions(option_lines);
    setSchema(id, schema);
    return schema;
  } catch {
    return [];
  }
}
```

- [ ] **Step 6: Reduce `app/src/lib/engineOptions.ts`** — delete the `ensureSchema` function (lines
73–92 of the original) and the now-unused `invoke, isTauri` import (line 6). Everything else (the
`SCHEMA_KEY`/`OVERRIDES_KEY` constants, `load`/`save`, `getSchema`, `onSchemaChange`, `setSchema`,
`getOverrides`, `setOption`, `resetOption`, `resetAll`, `effectiveValues`, `clear`) stays verbatim.
The file's remaining imports are `type UciOption` and `parseOptions` from `../engine/uciOptions`
and `get as getEngineRecord` from `./engineRegistry` — **keep only the ones still referenced**
(after removing `ensureSchema`, `parseOptions` and `getEngineRecord` are no longer used → delete
those two imports; keep `type UciOption`).

- [ ] **Step 7: Repoint `ensureSchema` importers** from `../lib/engineOptions` to `../lib/engineSchema`.

Find:
```bash
grep -rn "ensureSchema" app/src --include='*.ts' --include='*.svelte'
```
For each importer (component/engineClient), split the import: `ensureSchema` comes from
`'../lib/engineSchema'`; any store symbols (`setSchema`, `getOverrides`, …) keep coming from
`'../lib/engineOptions'`.

- [ ] **Step 8: Verify — full suites.**

Run:
```bash
( cd app && npm run check 2>&1 | tail -3 )
( cd app && npm test 2>&1 | tail -3 )
( cd extension && npm run check 2>&1 | tail -3 )
( cd extension && npx vitest run 2>&1 | tail -3 )
```
Expected: app check 0/0, app ~580 passed; extension check clean, 56 passed.

- [ ] **Step 9: Commit.**

```bash
git add -A
git commit -m "refactor(app): split capture.ts and engineOptions.ts Tauri seams

Pure image utils -> lib/image.ts (no Tauri); Capturer/hasNativeCapture
stay in capture.ts. The engine-option store stays in engineOptions.ts;
the Tauri probe ensureSchema -> lib/engineSchema.ts. Importers repointed.
Prepares both pure halves to move into @chessmenthol/core.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Atomic move of the shared set into `packages/core` (with shims)

Move all 29 modules + 34 tests + fixtures into the package, preserving subdirectory structure so
every intra-core relative import stays valid, and leave a re-export shim at each old `app/src` path
so app + extension keep resolving.

**Files:** `git mv` of the move set (see "The move set" above); create shim files; move tests.

- [ ] **Step 1: Baseline green** (as Task 1 Step 1).

- [ ] **Step 2: Move `core/`** (all 7):

```bash
mkdir -p packages/core/src/core
for f in accuracy chess classify orchestrator pgn report serialize; do
  git mv app/src/core/$f.ts packages/core/src/core/$f.ts
done
```

- [ ] **Step 3: Move `engine/` seam** (5, not nativeEngine):

```bash
mkdir -p packages/core/src/engine
for f in engine session types uci uciOptions; do
  git mv app/src/engine/$f.ts packages/core/src/engine/$f.ts
done
```

- [ ] **Step 4: Move `vision/` pipeline** (7, not vision-worker):

```bash
mkdir -p packages/core/src/vision
for f in coords detect pieces position tracker types visionClient; do
  git mv app/src/vision/$f.ts packages/core/src/vision/$f.ts
done
```

- [ ] **Step 5: Move `lib/`** (10):

```bash
mkdir -p packages/core/src/lib
for f in arrows board edit engineOptions engineRegistry evalbar image licon region types; do
  git mv app/src/lib/$f.ts packages/core/src/lib/$f.ts
done
```

- [ ] **Step 6: Move the migrated tests + fixtures.** Preserve the `tests/` structure so migrated
tests' `../core/x` imports and `./fixtures/...` loads stay valid.

```bash
mkdir -p packages/core/src/tests
for f in accuracy arrows classify coords coreChess detect edit editorPgn engineOptionsStore \
         engineRegistry engineTypes lastMove legalMoves moveToUci orchestrator orchestratorAnnotate \
         orchestratorEvalCache orchestratorReport pgn pieces position promotion region report \
         reportClassify serialize session tracker uci uciOptions visionClient visionTypes whitePct; do
  git mv app/src/tests/$f.test.ts packages/core/src/tests/$f.test.ts
done
git mv app/src/tests/visionFixtures.ts packages/core/src/tests/visionFixtures.ts
git mv app/src/tests/fixtures packages/core/src/tests/fixtures
# capture.test.ts tests the pure image utils -> move it and repoint its import to ../lib/image:
git mv app/src/tests/capture.test.ts packages/core/src/tests/image.test.ts
```
Then edit `packages/core/src/tests/image.test.ts`: change `from '../lib/capture'` to
`from '../lib/image'`. Also edit `packages/core/src/tests/visionFixtures.ts`: change any
`from '../lib/capture'` (RgbaImage) to `from '../lib/image'`.

**Read `packages/core/src/tests/image.test.ts` first:** if it also asserts on `Capturer` or
`hasNativeCapture`, move those specific cases back into a new `app/src/tests/capture.test.ts`
importing `../lib/capture` (per recon it imports only `decodeCaptureBuffer`/`cropImage`/`RgbaImage`,
so the whole file is expected to belong in core).

- [ ] **Step 7: Leave shims at every moved `app/src` path.** For each of the 29 moved source
modules, create a shim at its old path using the template (see Conventions):

```bash
emit_shim() { # $1 = dir, $2 = file
  printf '// TEMPORARY re-export shim (Plan 4) — deleted in Task 5. Real module: @chessmenthol/core/%s/%s\nexport * from '"'"'@chessmenthol/core/%s/%s'"'"';\n' "$1" "$2" "$1" "$2" > "app/src/$1/$2.ts"
}
for f in accuracy chess classify orchestrator pgn report serialize; do emit_shim core $f; done
for f in engine session types uci uciOptions; do emit_shim engine $f; done
for f in coords detect pieces position tracker types visionClient; do emit_shim vision $f; done
for f in arrows board edit engineOptions engineRegistry evalbar image licon region types; do emit_shim lib $f; done
```

- [ ] **Step 8: Verify no moved module has a `default` export** (which `export *` would not
re-export):

```bash
grep -rn "export default" packages/core/src/core packages/core/src/engine \
  packages/core/src/vision packages/core/src/lib || echo "no default exports — export * shims suffice"
```
Expected: `no default exports…`. (If any appears, append `export { default } from '…';` to that
module's shim.)

- [ ] **Step 9: Verify all suites green through the shims.**

Run:
```bash
( cd packages/core && npm test 2>&1 | tail -4 )
( cd app && npm run check 2>&1 | tail -3 )
( cd app && npm test 2>&1 | tail -3 )
( cd app && npx vite build 2>&1 | tail -4 )
( cd extension && npm run check 2>&1 | tail -3 )
( cd extension && npx vitest run 2>&1 | tail -3 )
```
Expected: **packages/core suite green** (the migrated ~34 files); app check 0/0 + ~546 remaining
tests pass + vite build ok; extension check clean + 56 pass. (app + extension resolve the moved
code through the shims / `@core` alias.)

**If a migrated core test fails resolving a helper that stayed in app**, it was misclassified —
move that test back to `app/src/tests` (or move the helper), and note it. The suite is the arbiter.

- [ ] **Step 10: Commit.**

```bash
git add -A
git commit -m "refactor(core): move shared modules into @chessmenthol/core (shimmed)

git mv of 29 core/engine/vision/lib modules + 34 tests + vision fixtures
into packages/core, subdir structure preserved so intra-core relative
imports stay valid. Re-export shims left at every old app/src path so app
and the extension keep resolving. packages/core now has its own green
vitest suite; app + extension green through the shims.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Repoint the app off the shims

Rewrite every app-staying importer from its old `app/src` relative path to the package specifier,
so `app/` no longer depends on any shim. (Shims remain for the extension until Task 5.)

**Files:** app-staying `.ts`/`.svelte` files that import a moved module; `EngineOptions.test.ts`.

- [ ] **Step 1: Enumerate the shim consumers in app** (find aid — the guarantee is Step 3's
hide-shims check, which also catches same-directory `./` imports this grep can miss).

```bash
MOVED="accuracy chess classify orchestrator pgn report serialize engine session uci uciOptions \
coords detect pieces position tracker visionClient arrows board edit engineOptions engineRegistry \
evalbar image licon region types"
for m in $MOVED; do
  grep -rnE "from '(\.\.?/)+([a-z]+/)?$m'" app/src --include='*.ts' --include='*.svelte'
done | sort -u
```
This lists app-staying importers of moved modules by relative path (components, `engineClient.ts`,
`nativeEngine.ts`, `vision-worker.ts`, `capture.ts`, `engineSchema.ts`, staying `lib/*`,
`App.svelte`, `main.ts`, app-staying tests). The `([a-z]+/)?` handles both `../engine/session` and
same-dir `./session`; the trailing `$m'` quote-anchor prevents `engine` matching `nativeEngine`.

- [ ] **Step 2: Rewrite each importer to the package specifier.** For every listed file, replace the
relative path with `@chessmenthol/core/<dir>/<file>` (the `<dir>/<file>` is exactly the shim's
target — visible in the shim file's own `export *` line). Examples:
- `import { Orchestrator } from '../core/orchestrator'` → `from '@chessmenthol/core/core/orchestrator'`
- `import { UciEngine } from './engine'` (in `nativeEngine.ts`) → `from '@chessmenthol/core/engine/engine'`
- `import { getOverrides } from '../lib/engineOptions'` → `from '@chessmenthol/core/lib/engineOptions'`
- `import { cropImage } from '../lib/image'` → `from '@chessmenthol/core/lib/image'`
- `import type { RgbaImage } from '../lib/capture'` → `from '@chessmenthol/core/lib/image'`
  (capture no longer needs to re-export `RgbaImage` — but leaving its `export type { RgbaImage }`
  is harmless; you may drop it once no app site imports `RgbaImage` from `../lib/capture`).

Also fix `app/src/tests/EngineOptions.test.ts`: `setSchema, getOverrides` now come from
`@chessmenthol/core/lib/engineOptions`.

- [ ] **Step 3: Definitively confirm app is off the shims** by hiding every shim, compiling app,
then restoring them (the extension still needs the shims until Task 5). Any surviving relative
import of a moved module — including same-directory `./` imports the Step-1 grep might miss — fails
`tsc` here and names the exact file to fix.

```bash
rm -rf /tmp/plan4-shims && mkdir -p /tmp/plan4-shims
grep -rl "TEMPORARY re-export shim (Plan 4)" app/src --include='*.ts' > /tmp/plan4-shimlist.txt
while read -r s; do mkdir -p "/tmp/plan4-shims/$(dirname "$s")"; mv "$s" "/tmp/plan4-shims/$s"; done < /tmp/plan4-shimlist.txt
( cd app && npx tsc -p tsconfig.app.json --noEmit 2>&1 | tail -20 )   # MUST be clean; errors name un-repointed app imports
while read -r s; do mv "/tmp/plan4-shims/$s" "$s"; done < /tmp/plan4-shimlist.txt
```
Expected: `tsc` prints nothing (0 errors) while the shims are hidden. If it errors, repoint the
named file(s) to `@chessmenthol/core/<dir>/<file>` and repeat until clean, then confirm the shims
were restored (`git status` shows no shim deletions).

- [ ] **Step 4: Verify app.**

Run:
```bash
( cd app && npm run check 2>&1 | tail -3 )
( cd app && npm test 2>&1 | tail -3 )
( cd app && npx vite build 2>&1 | tail -4 )
```
Expected: check 0/0; ~546 tests pass; build ok. (Extension untouched this task — still green via
`@core`→shims.)

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "refactor(app): import @chessmenthol/core directly, off the shims

Every app-staying importer now uses @chessmenthol/core/<dir>/<file> instead
of the old app/src relative paths. Shims remain only for the extension
(removed in Task 5). app check 0/0 + suite green + vite build ok.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extension cutover — duplicate components, repoint, drop the alias & devDep

**Files:**
- Create: `extension/entrypoints/sidepanel/components/{Board,EvalBar,Lines,Icon}.svelte`
- Modify: `extension/entrypoints/sidepanel/Panel.svelte`, all extension `@core/...` importers,
  `extension/wxt.config.ts`, `extension/vitest.config.ts`, `extension/tsconfig.json`,
  `extension/package.json`
- Delete: all 29 shim files under `app/src`

- [ ] **Step 1: Duplicate the 4 shared components** into the extension, rewriting their internal
`@core`/relative logic imports to `@chessmenthol/core`.

```bash
mkdir -p extension/entrypoints/sidepanel/components
for c in Board EvalBar Lines Icon; do
  cp app/src/components/$c.svelte extension/entrypoints/sidepanel/components/$c.svelte
done
```
Then in each copied `.svelte`, repoint its script imports of moved logic to the package:
- `Board.svelte`: `../lib/board` → `@chessmenthol/core/lib/board`; `../lib/arrows` →
  `@chessmenthol/core/lib/arrows`; `../lib/edit` → `@chessmenthol/core/lib/edit`;
  `../lib/types` → `@chessmenthol/core/lib/types`. Keep its `@lichess-org/chessground` import and
  the chessground `.css` imports (extension already has chessground).
- `EvalBar.svelte`: `../lib/evalbar` → `@chessmenthol/core/lib/evalbar`.
- `Lines.svelte`: `./Icon.svelte` stays relative (now the local copy); any `../lib/*` → package.
- `Icon.svelte`: `../lib/licon` → `@chessmenthol/core/lib/licon`.

Confirm no copied component still imports `@core` or `../lib`:
```bash
grep -rnE "@core|\.\./lib/" extension/entrypoints/sidepanel/components || echo "components clean"
```

- [ ] **Step 2: Point `Panel.svelte` at the local components.** In
`extension/entrypoints/sidepanel/Panel.svelte`, change:
```svelte
import Board from '@core/components/Board.svelte';
import EvalBar from '@core/components/EvalBar.svelte';
import Lines from '@core/components/Lines.svelte';
```
to:
```svelte
import Board from './components/Board.svelte';
import EvalBar from './components/EvalBar.svelte';
import Lines from './components/Lines.svelte';
```

- [ ] **Step 3: Repoint all remaining extension `@core/...` TS imports to `@chessmenthol/core/...`.**

```bash
grep -rn "@core/" extension --include='*.ts' --include='*.svelte'
```
For every remaining hit (all are `@core/<dir>/<file>` TS modules now — components were handled in
Steps 1–2), replace `@core/` with `@chessmenthol/core/`. Then verify none remain:
```bash
grep -rn "@core/" extension --include='*.ts' --include='*.svelte' || echo "no @core left"
```
Expected: `no @core left`.

- [ ] **Step 4: Remove the `@core` alias** from the three extension configs.
- `extension/wxt.config.ts`: delete the `resolve: { alias: { '@core': … } }` entry (keep `worker`
  and `optimizeDeps`). If `resolve` becomes empty, drop it.
- `extension/vitest.config.ts`: delete `'@core': resolve(__dirname, '../app/src')` from
  `resolve.alias` (keep `conditions: ['browser']`). If `alias` becomes empty, drop it.
- `extension/tsconfig.json`: delete the `"paths": { "@core/*": ["../app/src/*"] }` entry (leave an
  empty `compilerOptions` object or drop it so it just extends `./.wxt/tsconfig.json`).

- [ ] **Step 5: Drop the `@tauri-apps/api` devDependency.**

Edit `extension/package.json`: remove the `"@tauri-apps/api": "^2.11.1"` line from
`devDependencies`. Then:
```bash
npm install
grep -rn "@tauri-apps/api" extension/src extension/entrypoints || echo "no tauri api usage in extension"
```
Expected: `no tauri api usage in extension` (nothing imports it — it was only a transitive drag,
now gone).

- [ ] **Step 6: Delete the shims** (nothing uses them now — app repointed in Task 4, extension in
this task).

```bash
for f in accuracy chess classify orchestrator pgn report serialize; do rm app/src/core/$f.ts; done
for f in engine session types uci uciOptions; do rm app/src/engine/$f.ts; done
for f in coords detect pieces position tracker types visionClient; do rm app/src/vision/$f.ts; done
for f in arrows board edit engineOptions engineRegistry evalbar image licon region types; do rm app/src/lib/$f.ts; done
```
Confirm the moved dirs contain only the stayers:
```bash
ls app/src/core 2>/dev/null || echo "core/ empty (removed)"; ls app/src/engine; ls app/src/vision; ls app/src/lib
```
Expected: `app/src/core` empty/absent; `engine/` = `nativeEngine.ts`; `vision/` = `vision-worker.ts`;
`lib/` = `capture engineClient engineSchema glyphs moveclass options squareCorner viewport viewprefs`.
Remove the now-empty `app/src/core` dir if present (`rmdir app/src/core`).

- [ ] **Step 7: Verify everything.**

```bash
( cd app && npm run check 2>&1 | tail -3 )
( cd app && npm test 2>&1 | tail -3 )
( cd extension && npm run check 2>&1 | tail -3 )
( cd extension && npx vitest run 2>&1 | tail -3 )
( cd extension && npx wxt build 2>&1 | tail -5 )
( cd extension && npx wxt build -b firefox 2>&1 | tail -5 )
( cd packages/core && npm test 2>&1 | tail -3 )
```
Expected: app check 0/0 + suite green; extension check clean + 56 pass + **both browser builds
succeed**; core suite green. No `@core` alias, no `@tauri-apps/api`, no shims anywhere.

- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "refactor(ext): cut over to @chessmenthol/core; retire @core alias + tauri devDep

Duplicated Board/EvalBar/Lines/Icon into the extension (logic still from
the package); repointed all extension imports to @chessmenthol/core;
removed the @core alias from wxt/vitest/tsconfig and the @tauri-apps/api
devDependency. Deleted the Task-3 shims. Extension 56 green + both browser
builds; app + core green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Workflows, docs, and memory

**Files:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `CLAUDE.md`, project memory.

- [ ] **Step 1: Update `ci.yml`** to install once at the root workspace and add the core suite.
- Both `cache-dependency-path: app/package-lock.json` → `package-lock.json`.
- In the `test` job, replace the app-scoped install with a root install and add a core-test step:
  ```yaml
      - name: Install workspaces
        run: npm ci
      - name: Vitest (core)
        run: npm test --workspace @chessmenthol/core
      - name: Vitest (app)
        working-directory: app
        run: npm run test
      - name: Typecheck (app)
        working-directory: app
        run: npx tsc -p tsconfig.app.json --noEmit
      - name: Svelte check (app)
        working-directory: app
        run: npx svelte-check --tsconfig ./tsconfig.app.json
  ```
  (Remove the old `working-directory: app` + `npm ci` install step.)
- In the `build-smoke` job, replace `working-directory: app` / `npm ci` with a root `npm ci` step
  (keep the sidecar + `npx tauri build --no-bundle` steps under `working-directory: app`).

- [ ] **Step 2: Update `release.yml`.**
- `cache-dependency-path: app/package-lock.json` → `package-lock.json`.
- Replace the `working-directory: app` / `run: npm ci` install step with a root `run: npm ci`.
- Leave the sidecar step (`working-directory: app`) and `tauri-action` (`projectPath: app`)
  unchanged — deps resolve from the hoisted root `node_modules`.

- [ ] **Step 3: Rewrite the CLAUDE.md "Commands" preamble and add a monorepo note.** Replace the
line "All commands run from `app/` (that is the npm project root; the repo root has no
package.json)." with a short description of the workspace layout: root `package.json` with
workspaces `packages/*`, `app`, `extension`; `npm install` runs at the root; `@chessmenthol/core`
holds the shared chess/engine/vision/lib code (TS-only, source-only, `exports ./* -> ./src/*.ts`);
`app/` and `extension/` import it as `@chessmenthol/core/<dir>/<file>`. Update the `core/` and
`engine/`/`vision/` architecture sections to say those modules now live under `packages/core/src`.
Add the **component-drift caveat**: `Board`/`EvalBar`/`Lines`/`Icon` exist in both
`app/src/components` and `extension/entrypoints/sidepanel/components` — edit both copies together.
Remove the now-false "repo root has no package.json" claim wherever it appears.

- [ ] **Step 4: Verify docs don't break any command.** Re-read the edited CLAUDE.md Commands block
and run each command it now lists to confirm it works from the stated directory (at minimum
`npm ci` at root, `npm test --workspace @chessmenthol/core`, `cd app && npm run check`).

- [ ] **Step 5: Update project memory.** Edit
`/home/buga/.claude/projects/-home-buga-Dev-ChessMenthol/memory/browser-extension.md` (and its
`MEMORY.md` index line) to mark Plan 4 IMPLEMENTED: `@chessmenthol/core` workspace package extracted;
`@core` alias + `@tauri-apps/api` devDep retired; components duplicated; core tests migrated;
workflows switched to root install; note the final gate numbers and that the manual cross-browser +
desktop gates remain pending.

- [ ] **Step 6: Final full verification.**

```bash
npm ci
npm test --workspace @chessmenthol/core 2>&1 | tail -3
( cd app && npm run check && npm test 2>&1 | tail -3 )
( cd extension && npm run check && npx vitest run 2>&1 | tail -3 && npx wxt build 2>&1 | tail -3 && npx wxt build -b firefox 2>&1 | tail -3 )
```
Expected: root install clean; core green; app 0/0 + green; extension clean + 56 + both builds.

- [ ] **Step 7: Commit.**

```bash
git add -A
git add -f docs/superpowers/plans/2026-07-12-browser-extension-4-packages-core-extraction.md
git commit -m "chore(ci,docs): root-workspace install; document @chessmenthol/core

CI + release install once at the root workspace (single lockfile) and CI
runs the core suite; CLAUDE.md rewritten for the monorepo layout with the
component-duplication caveat; memory updated. Plan 4 complete.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done

- `@chessmenthol/core` is a workspace package; `app/` and `extension/` import it as
  `@chessmenthol/core/<dir>/<file>`; no `@core` alias, no shims, no `@tauri-apps/api` in the
  extension.
- Gates green: `packages/core` vitest · app `npm test` (~546) + `npm run check` 0/0 + `vite build` ·
  extension `vitest` (56) + `check` + `wxt build` (chrome-mv3 & firefox-mv2).
- CI/release install at the root workspace; CLAUDE.md + memory reflect the new layout.
- **Human-only gates still pending (unchanged):** Tauri desktop pass and the unpacked-extension
  cross-browser gate.

## Notes for the executor

- **Test-count arithmetic:** ~580 app tests split into ~34 migrated files (→ core) and the rest
  (~546) staying in app. Exact numbers depend on cases-per-file; the requirement is *both suites
  green and their sum unchanged*, not a specific app count. If the sum drops, a test was lost in a
  move — find it.
- **The suite is the arbiter of classification.** If a migrated test can't resolve something that
  stayed in app (or vice-versa), the move set was slightly off for that file — relocate it and note
  it. Don't weaken a test to make it pass.
- **Don't push mid-plan** (see Conventions) — push only after Task 6 so CI sees the fixed workflows.
