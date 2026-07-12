# Plan 4 — `packages/core` monorepo extraction

**Date:** 2026-07-12
**Branch:** `feat/browser-extension` (worktree `.claude/worktrees/browser-extension`)
**Series:** Browser-extension port, Plan 4 of 4. Follows Plans 1–3 (skeleton+WASM engine,
board sources, panel polish — all implemented, unmerged).

## Goal

Retire the two seams that let the browser extension reuse the desktop core:

1. **The `@core → ../app/src` path alias** — the extension currently reaches directly into
   `app/src` for ~18 modules + 4 Svelte components. Replace with a real npm-workspace package
   `@chessmenthol/core` that both `app/` and `extension/` depend on.
2. **The `@tauri-apps/api` devDependency** — present in `extension/package.json` only because two
   reused files (`lib/capture.ts`, `lib/engineOptions.ts`) co-locate portable code with Tauri
   IPC. Split those files so the portable halves carry no Tauri import; drop the devDep.

End-state: `packages/core` has **zero** `@tauri-apps/api` imports; the extension imports only
`@chessmenthol/core` + its own deps; the `@core` alias is gone; the desktop's ~580 tests and the
extension's 56 tests stay green throughout.

## Decisions (locked in brainstorming)

- **Scope:** Full extraction now (not staged, not seam-fix-only).
- **Package shape:** `packages/core` is **TS-only**. The 4 shared Svelte components
  (`Board`/`EvalBar`/`Lines`/`Icon`) stay in `app/src/components`; the extension gets its **own
  copies**. Only the thin `.svelte` view layer is duplicated — the logic (`board.ts`, `arrows.ts`,
  `evalbar.ts`, `licon.ts`) lives in core and is imported by both copies. Accepted tradeoff: 4
  files can drift; the shared logic cannot. This keeps `svelte`/`chessground` out of the package.
- **Build model:** **Source-only** — no build step. Consumers' bundlers/type-checkers compile the
  package's `.ts` directly via the workspace symlink ("internal package" pattern).
- **Tests:** Core-specific test files **migrate into `packages/core`**; `app/` keeps only
  component/Tauri/integration tests. The package ships its own vitest suite.
- **Import specifier:** Retire `@core`; use `@chessmenthol/core/...` subpaths. Accepted the minor
  cosmetic `core/core/chess` double segment (flatten later only if it grates).

## Target repository shape

```
/                             ← NEW root package.json: { private, workspaces:["packages/*","app","extension"] }
├─ package-lock.json          ← NEW single root lockfile (per-package lockfiles removed)
├─ packages/
│  └─ core/                    ← NEW · @chessmenthol/core · TS-only · source-only
│     ├─ package.json          name, type:module, exports { "./*": "./src/*.ts" },
│     │                        deps: chessops · devDeps: vitest, jsdom, @testing-library/*
│     ├─ tsconfig.json         moduleResolution: bundler
│     ├─ vitest.config.ts      environment jsdom, resolve.conditions ['browser']
│     └─ src/
│        ├─ core/    chess classify serialize orchestrator report accuracy pgn
│        ├─ engine/  engine(seam) session uci uciOptions types           (NOT nativeEngine)
│        ├─ vision/  detect coords pieces position tracker types visionClient  (NOT vision-worker)
│        ├─ lib/     types region board arrows edit evalbar licon engineRegistry
│        │           image(← capture split) engineOptions(← store half of engineOptions split)
│        └─ tests/   migrated core-specific test files (+ their fixtures)
├─ app/                        desktop → imports @chessmenthol/core
│  └─ src/
│     ├─ components/           ALL components incl. the 4 shared (stay here)
│     ├─ engine/nativeEngine.ts   (Tauri)
│     ├─ vision/vision-worker.ts  (app's onnxruntime-web/wasm worker)
│     ├─ lib/capture.ts        Tauri Capturer + hasNativeCapture (image utils now imported from core)
│     ├─ lib/engineOptions.ts  ensureSchema only (store fns now imported from core)
│     ├─ lib/engineClient.ts, viewport, viewprefs, glyphs, moveclass, options, squareCorner …
│     └─ App.svelte, main.ts, app.css, tests/ (component/Tauri/integration only)
└─ extension/                  imports @chessmenthol/core
   ├─ …/components/            NEW copies of Board/EvalBar/Lines/Icon.svelte (+ their css imports)
   └─ wxt.config.ts, vitest.config.ts, tsconfig.json  ← @core alias removed
      package.json             ← @tauri-apps/api devDep removed
```

## Package mechanics — source-only "internal package"

- **Name:** `@chessmenthol/core`. **`exports`:** `{ "./*": "./src/*.ts" }`, so consumers write
  `import { assembleFromGrid } from '@chessmenthol/core/core/chess'`,
  `import { Tracker } from '@chessmenthol/core/vision/tracker'`,
  `import type { Command } from '@chessmenthol/core/lib/types'`. Path shapes mirror today's
  `@core/<dir>/<file>` layout, so import rewrites are a mechanical prefix swap.
- **No build step.** Resolution works because both consumers already use **bundler** module
  resolution: `app/tsconfig.app.json` (via `@tsconfig/svelte`) and the extension's
  `.wxt/tsconfig.json` (`moduleResolution: Bundler`). Vite (app), WXT/Rollup (extension), Vitest
  (both), and svelte-check (both) all compile the workspace-linked `.ts` directly.
- **Alias removal:** delete the `@core` alias from `extension/wxt.config.ts:30`,
  `extension/vitest.config.ts:8`, and `extension/tsconfig.json` `paths`.
- **Task-1 proof gate:** before moving any code, the empty scaffolded package must be importable
  from a trivial re-export in both app and extension with all four checkers green. If source-only
  `.ts` exports don't resolve in some checker, that is discovered here — before risk.

## The two Tauri splits

**`app/src/lib/capture.ts`** (59 lines):
- **→ `packages/core/src/lib/image.ts`:** `interface RgbaImage`, `decodeCaptureBuffer`, `cropImage`
  (all pure). 
- **Stays in `app/src/lib/capture.ts`:** `hasNativeCapture()`, `class Capturer` (both use
  `invoke`/`isTauri`). The file re-imports `RgbaImage`/`decodeCaptureBuffer` from
  `@chessmenthol/core/lib/image`.
- **Importer rewrites:** everything using `RgbaImage`/`cropImage`/`decodeCaptureBuffer` points at
  the new module — app: `serialize.ts`, `orchestrator.ts`, `visionClient.ts`, `vision/types.ts`,
  `Capturer`; extension: `tabCapturer.ts`, `visionTracker.ts`, `vision-worker.ts` (+ tests).

**`app/src/lib/engineOptions.ts`** (93 lines):
- **→ `packages/core/src/lib/engineOptions.ts`:** the entire localStorage schema/override store —
  `SCHEMA_KEY`, `OVERRIDES_KEY`, `load`/`save`, `getSchema`, `onSchemaChange`, `setSchema`,
  `getOverrides`, `setOption`, `resetOption`, `resetAll`, `effectiveValues`, `clear`. No Tauri.
- **Stays in `app/src/lib/engineOptions.ts`:** only `ensureSchema` (lines 76–92) — the
  `invoke('engine_probe')`/`isTauri()` path. It re-imports `getSchema`/`setSchema` and
  `parseOptions`/`getEngineRecord` from core. Its lone consumer(s) are desktop (EngineOptions
  form / engineClient); the extension never calls it.
- **Result:** `orchestrator.ts` reached Tauri **only** through these two files (RgbaImage type +
  the override store). Both now resolve to Tauri-free core modules → the entire `packages/core`
  graph is Tauri-free.

## What moves vs. stays

**Moves into `packages/core/src`** (whole coherent modules):
- `core/`: chess, classify, serialize, orchestrator, report, accuracy, pgn
- `engine/`: engine, session, uci, uciOptions, types
- `vision/`: detect, coords, pieces, position, tracker, types, visionClient
- `lib/`: types, region, board, arrows, edit, evalbar, licon, engineRegistry, **image** (new,
  from capture split), **engineOptions** (store half)

**Stays in `app/src`** (desktop-only or Tauri-coupled):
- `engine/nativeEngine.ts` (Tauri IPC UCI process)
- `vision/vision-worker.ts` (app's own onnxruntime-web/wasm worker)
- `lib/`: capture.ts (Capturer half), engineOptions.ts (ensureSchema half), engineClient.ts,
  viewport, viewprefs, glyphs, moveclass, options, squareCorner
- All `components/*.svelte` (incl. the 4 shared), `App.svelte`, `main.ts`, `app.css`

**Extension gains:** own copies of `Board`/`EvalBar`/`Lines`/`Icon.svelte` (+ their css imports),
importing logic from `@chessmenthol/core`.

**Test migration principle:** a test file moves to `packages/core/src/tests` iff its subject
module moved to core (chess/classify/accuracy/serialize/orchestrator/report/pgn/uci/uciOptions/
session/engine/detect/coords/pieces/position/tracker/visionClient/board/arrows/evalbar/region/
types/engineRegistry + the engineOptions **store** tests). Component tests, Tauri tests
(nativeEngine, engineClient, the Capturer, the EngineOptions form, EngineList, Titlebar/
WindowResize), and the `ensureSchema` test stay in `app/`. Vision-test fixtures (PNG/HTML) move
with their tests. The plan enumerates the exact file list by reading `app/src/tests/` at
planning time.

## Migration order — one plan, suite green at every task

Bottom-up so each intermediate state compiles and both suites stay green after every commit:

1. **Scaffold workspace.** Root `package.json` + workspaces + empty `packages/core`
   (package.json/tsconfig/vitest/exports). Prove app + extension still build & test with **nothing
   moved** and a trivial core re-export imported from each side (the resolution proof gate).
2. **Split the two Tauri files.** Create `core/lib/image.ts` + `core/lib/engineOptions.ts`; reduce
   the app files to their Tauri halves; rewrite all importers (app + extension). Extension's Tauri
   drag is gone at this step.
3. **Move leaf modules** — the files that depend only on chessops or on nothing:
   `lib/types`, `lib/region`, `lib/licon`, `lib/engineRegistry`, `engine/types`, `vision/types`,
   and `core/chess` (`lib/image` is already in core from Task 2). Rewrite importers; migrate tests.
4. **Move `core/` logic** — classify, serialize, accuracy, report, pgn (depend on `core/chess` +
   the leaf types, now in core). Migrate tests.
5. **Move the `engine/` seam** — uci, uciOptions, engine, session, plus the `lib/engineOptions`
   store half (depends on `uciOptions` + `engineRegistry`). Migrate tests.
6. **Move `lib/` view-logic + the `vision/` pipeline** — `lib/board`/`arrows`/`edit`/`evalbar`
   (depend on `core/chess`/`accuracy`) and `vision/` detect/coords/pieces/position/tracker/
   visionClient (depend on `core/chess`). Migrate tests + fixtures.
7. **Move `core/orchestrator` last** — it depends on core, engine, lib, and vision types, so it can
   only move once all of those are in the package. Migrate its tests.
8. **Extension cutover.** Duplicate the 4 components; repoint every extension import to
   `@chessmenthol/core`; delete the `@core` alias (wxt/vitest/tsconfig); drop the
   `@tauri-apps/api` devDep.
9. **Workflows + docs.** Update `ci.yml`/`release.yml` to install at the root workspace (single
   lockfile; `working-directory: app` → root `npm ci`, tauri-action still builds from `app/`);
   rewrite CLAUDE.md's "commands run from `app/`" section and the architecture notes; update the
   `browser-extension` memory.

Ordering invariant: move **deepest dependencies first**, so every file entering `packages/core`
finds all of its own imports already in the package (or moving in the same task). The forbidden
direction is a core file importing an app file; app→core is the intended one and is rewritten as
each batch lands. Note `lib/board`/`lib/arrows` depend on `core/`, so core precedes them (not the
naive "all lib first"), and `orchestrator` sits atop the graph and moves last.

## Verification

Per task and at the end:
- **app:** `npm test` (~580 pass) · `npm run check` (0 errors, 0 warnings) · `npm run build`
- **packages/core:** `vitest run` (migrated suite green)
- **extension:** `vitest run` (56 pass) · `npm run check` · `wxt build` (chrome-mv3) ·
  `wxt build -b firefox`
- **Human-only gates (unchanged):** Tauri desktop pass
  (`WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`) and the unpacked-extension cross-browser
  gate.

## Integration surfaces & risks

- **Install model changes.** One root `package-lock.json`; per-package lockfiles removed;
  `npm install`/`npm ci` runs at the repo root and hoists. CI (`ci.yml`) and release
  (`release.yml`) currently `cd`/`working-directory: app` with `cache-dependency-path:
  app/package-lock.json` — must become root install. tauri-action still builds from `app/` (deps
  resolved from the hoisted root `node_modules`). **This is the highest-risk non-code surface;
  Task 9 owns it and must be validated by re-reading the workflows, not assumed.**
- **Source-only `.ts` exports** depend on bundler resolution in *every* consumer/toolchain — proven
  in Task 1 before any move.
- **Large `app/` diff on the extension branch.** This restructures `app/`, which is shared with
  `main`. The branch was chosen knowingly. Sequencing (land as its own PR to `main` first, then
  rebase the extension, vs. keep it all on the extension branch) is a **finish-time** decision,
  not part of this plan.
- **Component drift.** The 4 duplicated `.svelte` files must be kept in sync manually; noted in
  CLAUDE.md so future edits touch both copies.

## Non-goals

- No behavior changes — pure restructure. Every pinned test number stays pinned.
- No publishing `@chessmenthol/core` to a registry (it's a private workspace package).
- No move of desktop-only components or the desktop-only `lib/` utilities.
- No change to the vision/engine runtime models, the command→frame surface, or any UI.
- Not resolving the pending manual cross-browser gate (still human-only, unchanged).
