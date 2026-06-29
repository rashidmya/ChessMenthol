# Svelte + Tauri Migration — Phase 3: Cut Over + Ship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the entire Python backend (now fully superseded by the ported TypeScript/WASM stack), finalize the Tauri bundle, generate a real app icon, add a win/linux/macOS release CI matrix, and document the new build/run/release flow — completing the migration and the original **M5c packaging** milestone.

**Architecture:** This is a **cut-over + ship** phase, not a feature phase. Group i *decouples* the frontend from the Python tree (relocates the committed `pieces.onnx`, trims the onnxruntime-web wasm bloat, drops the now-dead fixture-copy script) so that Group ii can delete all Python with the full Vitest + `tsc` + `svelte-check` + `cargo build` suite still green — that green suite **is the proof** nothing depended on Python. Group iii finalizes packaging (new icon + `tauri.conf.json` bundle, gated by a real local `tauri build`), Group iv adds the GitHub Actions release + CI workflows, and Group v writes the docs and runs the final human verification.

**Tech Stack:** Node/npm, Vite, Vitest, TypeScript, Svelte 5 (all existing); **Tauri 2** (`@tauri-apps/cli` already installed) + the `tauri icon` generator; **GitHub Actions** with `tauri-apps/tauri-action@v0`; `rsvg-convert` (present on the dev box) for one-time icon rasterization.

**Spec:** `docs/superpowers/specs/2026-06-28-svelte-tauri-migration-design.md` (§8 Packaging, §9 Phase 3). **Builds on:** Phase 1a/1b/2 (all done on `feat/svelte-tauri-migration`; vi.2 vision manual check PASSED). **Stack on the SAME branch `feat/svelte-tauri-migration` — do NOT merge to `main`.**

**Decisions locked in (from the Phase-3 brainstorm, 2026-06-29):**

1. **CI:** pushing a `v*` git tag runs the 3-OS matrix and uploads `.msi`/`.exe`, `.dmg`/`.app`, `.AppImage`/`.deb` to a **draft GitHub Release** (`tauri-apps/tauri-action`); PR/branch pushes run a **build-only smoke** (no upload).
2. **App icon:** design a **new** chess + menthol mark at 1024² and run `tauri icon` (do NOT reuse `favicon.svg`).
3. **`WEBKIT_DISABLE_DMABUF_RENDERER=1`:** **document only** (README + launcher hint) — no env-setting in Rust.
4. **Region-select dimmed backdrop:** **out of scope** (dropped, not deferred-with-task).

---

## Conventions (read before starting)

- **Working dir:** almost every command runs from `frontend/`. Paths below are repo-relative from `/home/buga/Dev/ChessMenthol` unless a `cd` is shown.
- **The full automated gate** (run after any task that could affect the app):
  ```bash
  cd frontend && npm run test \
    && npx tsc -p tsconfig.app.json --noEmit \
    && npx svelte-check --tsconfig ./tsconfig.app.json \
    && ( cd src-tauri && cargo build )
  ```
  Baseline before starting Phase 3: **381 Vitest tests pass, `tsc` clean, `svelte-check` 0 errors / 0 warnings, `cargo build` clean.** Every task must leave this baseline green (test count only grows).
- **This phase is mostly deletion + config, not TDD.** Where a change is behavior-verifiable by the existing suite, the existing suite is the gate. Where it is deletion, the gate is "full suite still green AND no source references the deleted paths." Where it is build/packaging/CI config, the gate is the explicit build/validate command shown in the task. Each task ends with a commit.
- **Commit style:** match the existing branch history — `type(scope): summary` (e.g. `chore(python): delete the superseded Python backend`). End-of-task commits only; do not push (the user manages the remote/merge).
- **Never delete Python before Group i is fully committed.** Group i removes every runtime/test dependency on the `chessmenthol/` and `tests/` trees; Group ii's deletion is safe *only* afterward.

---

## File structure (created / modified / deleted in this phase)

| Path | Action | Responsibility |
|---|---|---|
| `frontend/models/pieces.onnx` | **Create** (via `git mv`) | New committed source-of-truth for the piece-classifier model (was `chessmenthol/models/pieces.onnx`). |
| `frontend/scripts/copy-vision-assets.mjs` | Modify | Read the model from `../models/pieces.onnx`; copy **only** `ort-wasm-simd-threaded.wasm` (not all ~93 MB of variants). |
| `frontend/scripts/prune-dist-ort.mjs` | **Create** (conditional) | `postbuild` prune of any stray large ort `.wasm` Vite emits into `dist/assets` (only if the build actually emits one). |
| `frontend/src/tests/pieces.test.ts` | Modify (line 53) | Repoint the node-parity model path to `../../models/pieces.onnx`. |
| `frontend/scripts/copy-vision-fixtures.mjs` | **Delete** | Dead one-time copier (fixtures are committed under `frontend/src/tests/fixtures/vision/`; its Python source is being deleted). |
| `frontend/package.json` | Modify | Drop the `copy-vision-fixtures` script; add `postbuild` (if the prune is needed) + the `tauri` script already exists. |
| `chessmenthol/` | **Delete** (entire) | Python package: cli, position, analysis, engine, server, vision, engines/, models/, server/static/. |
| `scripts/` (repo root) | **Delete** (entire) | `fetch_engines.py`, `convert_pieces_model.py`, `__init__.py`. |
| `tests/` (repo root) | **Delete** (entire) | Python pytest suite + `tests/vision/fixtures/` (Python-side fixture copy). |
| `pyproject.toml` | **Delete** | Python packaging metadata. |
| `chessmenthol.egg-info/` | **Delete** (if present/untracked) | Generated package metadata. |
| `.gitignore` | Modify | Drop dead entries (`*.egg-info/`, `chessmenthol/engines/`, `chessmenthol/server/static/`). |
| `frontend/src/core/{classify,serialize,orchestrator}.ts`, `frontend/src/vision/{detect,pieces,position,tracker}.ts`, `frontend/src/lib/glyphs.ts`, `frontend/src/tests/pieces.test.ts` | Modify (comments) | Update dangling `port of chessmenthol/*.py` header comments to past-tense "(removed in the migration)". |
| `frontend/src-tauri/icons/*` | **Replace** | Real multi-res icon set generated by `tauri icon` from the new source. |
| `frontend/src-tauri/icons/source-icon.svg` + `source-icon.png` | **Create** | Committed 1024² icon source (SVG + rasterized PNG). |
| `frontend/src-tauri/tauri.conf.json` | Modify | Finalize bundle: explicit per-OS targets, metadata, Linux deb deps, `bundle.icon` list. |
| `.github/workflows/release.yml` | **Create** | Tag-`v*` → 3-OS matrix → draft GitHub Release with installers (`tauri-action`). |
| `.github/workflows/ci.yml` | **Create** | PR/push → Vitest + `tsc` + `svelte-check` + 3-OS build-only smoke. |
| `README.md` (repo root) | **Create** | Real project README: stack, prereqs, dev/build/release, Linux Wayland notes. |
| `frontend/README.md` | Modify | Replace the stock Vite boilerplate with a short pointer to the root README. |
| `NOTICE.md` | Modify | Refresh third-party notices for the new stack (chessops, onnxruntime-web, xcap, Tauri; reframe Stockfish as wasm). |

---

## Task Group i — Decouple the frontend from the Python tree

> Goal: after this group, **nothing** under `frontend/` reads from `chessmenthol/` or `tests/`, and the ort wasm payload shrinks from ~93 MB to ~13.5 MB. The full gate stays green throughout. Only then is Group ii's deletion safe.

### Task i.1: Relocate `pieces.onnx` into the frontend and repoint its two consumers

**Context:** `pieces.onnx` is git-tracked **only** at `chessmenthol/models/pieces.onnx`. The `frontend/public/models/pieces.onnx` copy is *generated and gitignored*. Two committed files read the Python path: `frontend/scripts/copy-vision-assets.mjs:12` (runtime asset copy) and `frontend/src/tests/pieces.test.ts:53` (node parity test). Both must move to a new committed home, `frontend/models/pieces.onnx`, **before** the Python tree is deleted.

**Files:**
- Move: `chessmenthol/models/pieces.onnx` → `frontend/models/pieces.onnx` (preserve git history)
- Modify: `frontend/scripts/copy-vision-assets.mjs:12`
- Modify: `frontend/src/tests/pieces.test.ts:53`

- [ ] **Step 1: Relocate the model with `git mv` (preserves history)**

```bash
cd /home/buga/Dev/ChessMenthol
mkdir -p frontend/models
git mv chessmenthol/models/pieces.onnx frontend/models/pieces.onnx
```
Expected: the file moves; `git status` shows `renamed: chessmenthol/models/pieces.onnx -> frontend/models/pieces.onnx`. Verify size is intact (~627 KB):
```bash
ls -l frontend/models/pieces.onnx
```

- [ ] **Step 2: Repoint the runtime copy script**

In `frontend/scripts/copy-vision-assets.mjs`, change the model source line (currently line 12):

```js
// 1. Model: chessmenthol/models/pieces.onnx -> public/models/pieces.onnx
const MODEL_SRC = join(here, '..', '..', 'chessmenthol', 'models', 'pieces.onnx');
```
to:
```js
// 1. Model: frontend/models/pieces.onnx -> public/models/pieces.onnx
const MODEL_SRC = join(here, '..', 'models', 'pieces.onnx');
```

- [ ] **Step 3: Repoint the node-parity test**

In `frontend/src/tests/pieces.test.ts`, change line 53:

```ts
const MODEL = fileURLToPath(new URL('../../../chessmenthol/models/pieces.onnx', import.meta.url));
```
to:
```ts
const MODEL = fileURLToPath(new URL('../../models/pieces.onnx', import.meta.url));
```
(From `frontend/src/tests/`, `../../models` resolves to `frontend/models`.)

- [ ] **Step 4: Verify the asset copy + the parity test both still work**

```bash
cd frontend && npm run copy-vision-assets
```
Expected: `[copy-vision-assets] copied pieces.onnx + ort runtime into public/` and `public/models/pieces.onnx` exists.
```bash
cd frontend && npx vitest run src/tests/pieces.test.ts
```
Expected: PASS, including the `pieces — committed model classifies real crops (>=95%)` describe block running (NOT skipped — proving the model was found at the new path).

- [ ] **Step 5: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add chessmenthol/models frontend/models/pieces.onnx frontend/scripts/copy-vision-assets.mjs frontend/src/tests/pieces.test.ts
git commit -m "refactor(assets): relocate pieces.onnx into frontend/models, repoint copy script + parity test"
```

### Task i.2: Trim the onnxruntime-web wasm bloat (~93 MB → ~13.5 MB)

**Context:** `copy-vision-assets.mjs` currently copies **every** `.wasm` and `.mjs` from `onnxruntime-web/dist` into `public/ort` (~93 MB: asyncify 24 MB, jsep 26 MB, jspi 15 MB, plain 13.5 MB, plus a dozen `.mjs` bundles). At runtime the app imports `onnxruntime-web/wasm` (embedded-glue bundle build) and sets `ort.env.wasm.wasmPaths = { wasm: '/ort/ort-wasm-simd-threaded.wasm' }` with `executionProviders: ['wasm']` and `numThreads = 1` (see `frontend/src/vision/vision-worker.ts:20-35`). So the **only** file ever fetched is `ort-wasm-simd-threaded.wasm` (13.5 MB). Copy just that one. No `.mjs` is needed in `public/ort` (the glue is embedded in the bundle).

**Files:**
- Modify: `frontend/scripts/copy-vision-assets.mjs` (the ort-copy loop)
- (Conditional) Create: `frontend/scripts/prune-dist-ort.mjs` + a `postbuild` script in `frontend/package.json`

- [ ] **Step 1: Copy only the one runtime wasm**

In `frontend/scripts/copy-vision-assets.mjs`, replace the ort-runtime block:

```js
// 2. ort runtime: node_modules/onnxruntime-web/dist/*.wasm + *.mjs -> public/ort/
const ORT_SRC = join(here, '..', 'node_modules', 'onnxruntime-web', 'dist');
if (!existsSync(ORT_SRC)) {
  console.error(`[copy-vision-assets] missing ${ORT_SRC} — run npm install`);
  process.exit(1);
}
mkdirSync(join(PUB, 'ort'), { recursive: true });
for (const f of readdirSync(ORT_SRC)) {
  if (statSync(join(ORT_SRC, f)).isFile() && (f.endsWith('.wasm') || f.endsWith('.mjs'))) {
    copyFileSync(join(ORT_SRC, f), join(PUB, 'ort', f));
  }
}
console.log('[copy-vision-assets] copied pieces.onnx + ort runtime into public/');
```
with (the app loads ONLY this one wasm via `ort.env.wasm.wasmPaths`; the JS glue is embedded in the `onnxruntime-web/wasm` bundle, so no `.mjs` is shipped):

```js
// 2. ort runtime: the app uses the `onnxruntime-web/wasm` bundle build (embedded
// glue) and fetches exactly ONE artifact — ort-wasm-simd-threaded.wasm — via
// ort.env.wasm.wasmPaths (see frontend/src/vision/vision-worker.ts). Copying the
// other variants (asyncify/jsep/jspi + every .mjs bundle, ~80 MB) is dead weight.
const ORT_SRC = join(here, '..', 'node_modules', 'onnxruntime-web', 'dist');
const ORT_WASM = 'ort-wasm-simd-threaded.wasm';
if (!existsSync(join(ORT_SRC, ORT_WASM))) {
  console.error(`[copy-vision-assets] missing ${join(ORT_SRC, ORT_WASM)} — run npm install`);
  process.exit(1);
}
mkdirSync(join(PUB, 'ort'), { recursive: true });
copyFileSync(join(ORT_SRC, ORT_WASM), join(PUB, 'ort', ORT_WASM));
console.log(`[copy-vision-assets] copied pieces.onnx + ${ORT_WASM} into public/`);
```
The now-unused imports `readdirSync` and `statSync` must be removed from the top-of-file import (leave `mkdirSync, copyFileSync, existsSync`). The `readFileSync`/etc. are not present; only trim what's unused.

- [ ] **Step 2: Re-copy and confirm the payload shrank**

```bash
cd frontend
rm -rf public/ort
npm run copy-vision-assets
du -sh public/ort
ls -1 public/ort
```
Expected: `public/ort` is ~13.5 MB (was ~93 MB) and contains exactly `ort-wasm-simd-threaded.wasm`.

- [ ] **Step 3: Confirm the production build still resolves the wasm, and check for a stray Vite-emitted ort wasm in `dist`**

```bash
cd frontend && npm run build
echo "--- large wasm emitted into dist/assets (the suspected jsep double-bundle): ---"
find dist -name '*.wasm' -size +1M -exec ls -lh {} \;
```
Expected: the build succeeds. Inspect the `find` output:
- The legitimate engine wasm lives under `dist/engine/` (Stockfish) and `dist/ort/ort-wasm-simd-threaded.wasm` — those are correct, keep them.
- If a large ort wasm (e.g. `*jsep*.wasm` ~26 MB) appears under **`dist/assets/`**, it is the dead double-bundle (never fetched, because `wasmPaths` overrides the URL and the EP is `wasm`-only). Proceed to Step 4 to prune it. If `dist/assets` has **no** stray ort wasm, skip Step 4 and Step 5's `postbuild` wiring — just note it in the commit and move on.

- [ ] **Step 4: (Only if Step 3 found a stray ort wasm in `dist/assets`) Add a `postbuild` prune**

Create `frontend/scripts/prune-dist-ort.mjs`:

```js
// frontend/scripts/prune-dist-ort.mjs
// Vite statically emits an onnxruntime-web wasm variant into dist/assets from the
// `onnxruntime-web/wasm` import graph. The app NEVER fetches it: ort.env.wasm.wasmPaths
// pins the URL to /ort/ort-wasm-simd-threaded.wasm and the only execution provider is
// 'wasm', so the jsep/webgpu variant is unreachable. Tauri ships all of dist, so this
// dead file would bloat the bundle by ~26 MB. Prune any ort wasm under dist/assets.
// (The real runtime wasm under dist/ort/ and Stockfish under dist/engine/ are untouched.)
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, '..', 'dist', 'assets');
let pruned = 0;
try {
  for (const f of readdirSync(ASSETS)) {
    if (f.endsWith('.wasm') && /ort-wasm/i.test(f)) {
      const p = join(ASSETS, f);
      const mb = (statSync(p).size / 1e6).toFixed(1);
      rmSync(p);
      console.log(`[prune-dist-ort] removed dead dist/assets/${f} (${mb} MB)`);
      pruned++;
    }
  }
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (!pruned) console.log('[prune-dist-ort] no dead ort wasm in dist/assets (nothing to prune)');
```

In `frontend/package.json` `scripts`, add a `postbuild` that runs it after every `vite build`:

```json
    "build": "vite build",
    "postbuild": "node scripts/prune-dist-ort.mjs",
```

- [ ] **Step 5: Re-verify the trimmed build**

```bash
cd frontend && rm -rf dist && npm run build
find dist -name '*.wasm' -size +1M -exec ls -lh {} \;
```
Expected: only `dist/ort/ort-wasm-simd-threaded.wasm` (~13.5 MB) and the Stockfish wasm under `dist/engine/` remain; no ort wasm under `dist/assets/`.

- [ ] **Step 6: Full gate (the trim must not break any test)**

```bash
cd frontend && npm run test && npx tsc -p tsconfig.app.json --noEmit
```
Expected: 381 tests pass (the vitest vision tests use `onnxruntime-node` + the committed model, not `public/ort`, so they are unaffected), tsc clean.

- [ ] **Step 7: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/scripts/copy-vision-assets.mjs frontend/package.json frontend/scripts/prune-dist-ort.mjs 2>/dev/null
git commit -m "perf(ort): ship only ort-wasm-simd-threaded.wasm (~93MB -> ~13.5MB), prune dead dist bundle"
```
(If Step 4 was skipped, the `prune-dist-ort.mjs` / `package.json` `postbuild` are simply absent from the commit — that's fine.)

### Task i.3: Remove the dead `copy-vision-fixtures` script

**Context:** `frontend/scripts/copy-vision-fixtures.mjs` was a one-time copier from `tests/vision/fixtures` (Python tree) into `frontend/src/tests/fixtures/vision/`. The 31 frontend fixture files are now **committed** (`git ls-files frontend/src/tests/fixtures/vision | wc -l` → 31). The script's source dir is about to be deleted in Group ii, and the script is not referenced by `predev`/`prebuild` (only an explicit `copy-vision-fixtures` npm script). Delete both.

**Files:**
- Delete: `frontend/scripts/copy-vision-fixtures.mjs`
- Modify: `frontend/package.json` (remove the `copy-vision-fixtures` script line)

- [ ] **Step 1: Confirm the fixtures are committed (safety check before removing the copier)**

```bash
cd /home/buga/Dev/ChessMenthol
git ls-files 'frontend/src/tests/fixtures/vision/**' | wc -l
```
Expected: `31` (4 board PNGs + `ground_truth.json` + 26 piece crops). If not 31, STOP — do not remove the copier; investigate first.

- [ ] **Step 2: Delete the script**

```bash
cd /home/buga/Dev/ChessMenthol
git rm frontend/scripts/copy-vision-fixtures.mjs
```

- [ ] **Step 3: Remove its npm script**

In `frontend/package.json`, delete this line from `scripts`:
```json
    "copy-vision-fixtures": "node scripts/copy-vision-fixtures.mjs",
```
(Leave `copy-engine` and `copy-vision-assets` — both still used by `predev`/`prebuild`.)

- [ ] **Step 4: Verify nothing else references it**

```bash
cd /home/buga/Dev/ChessMenthol
grep -rn "copy-vision-fixtures" --include='*.json' --include='*.mjs' --include='*.md' frontend . | grep -v docs/superpowers || echo "no references — clean"
```
Expected: `no references — clean` (the only hits, if any, are in the design/plan docs, which are historical).

- [ ] **Step 5: Sanity — install/build hooks still resolve**

```bash
cd frontend && npm run copy-engine && npm run copy-vision-assets
```
Expected: both succeed (proves `predev`/`prebuild` chain is intact without the deleted script).

- [ ] **Step 6: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/package.json
git commit -m "chore(scripts): drop dead copy-vision-fixtures (fixtures are committed under frontend)"
```

---

## Task Group ii — Delete all Python

> Goal: remove the entire Python backend and test tree. The gate is **the full automated suite staying green** — that is the evidence nothing under `frontend/` depended on the deleted code.

### Task ii.1: Delete the Python package, scripts, tests, and packaging

**Files (all deletions, repo root):**
- Delete: `chessmenthol/` (entire — cli, position, analysis/, engine/, server/, vision/, engines/, server/static/, `__init__.py`; `models/` is already emptied by Task i.1)
- Delete: `scripts/` (entire — `fetch_engines.py`, `convert_pieces_model.py`, `__init__.py`)
- Delete: `tests/` (entire — pytest suite + `tests/vision/fixtures/`)
- Delete: `pyproject.toml`
- Delete (if present): `chessmenthol.egg-info/`
- Modify: `.gitignore`

- [ ] **Step 1: Pre-flight guard — confirm the decoupling is complete**

```bash
cd /home/buga/Dev/ChessMenthol
echo "--- frontend refs into chessmenthol/ or root tests/ (expect NONE in real source): ---"
grep -rn -e "chessmenthol/" -e "\.\./\.\./\.\./tests" frontend/src frontend/scripts frontend/package.json frontend/vite.config.ts 2>/dev/null \
  | grep -v -e "ported from" -e "port of" -e "original Python" || echo "CLEAN — no functional references"
echo "--- the relocated model is in place: ---"
test -f frontend/models/pieces.onnx && echo "OK: frontend/models/pieces.onnx" || echo "MISSING — STOP, Task i.1 incomplete"
```
Expected: `CLEAN — no functional references` (only comment strings like "ported from … (removed)" may remain — those are handled in Task ii.2) and `OK: frontend/models/pieces.onnx`. If a functional reference remains, STOP and fix it before deleting.

- [ ] **Step 2: Delete the Python trees**

```bash
cd /home/buga/Dev/ChessMenthol
git rm -r chessmenthol scripts tests pyproject.toml
rm -rf chessmenthol.egg-info        # generated, may be untracked
```
Expected: `git status` shows the deletions staged; `chessmenthol/`, `scripts/`, `tests/`, `pyproject.toml` gone from the working tree.

- [ ] **Step 3: Clean dead `.gitignore` entries**

In `.gitignore`, remove these three now-meaningless lines (the dirs no longer exist):
```
*.egg-info/
chessmenthol/engines/
chessmenthol/server/static/
```
Keep everything else (`__pycache__/`, `*.py[cod]`, `.venv/`, `venv/`, `.pytest_cache/` may stay harmlessly, or be trimmed too — leaving them is fine and lower-risk; do NOT remove `dist/`, `build/`, `.superpowers/`, `frontend/node_modules/`, `frontend/dist/`).

- [ ] **Step 4: Prove nothing broke — full gate**

```bash
cd frontend && npm run test \
  && npx tsc -p tsconfig.app.json --noEmit \
  && npx svelte-check --tsconfig ./tsconfig.app.json \
  && ( cd src-tauri && cargo build )
```
Expected: 381 Vitest tests pass, tsc clean, svelte-check 0/0, `cargo build` clean. **This green run is the definition of done for the deletion** — it proves the frontend + Tauri shell are fully self-contained.

- [ ] **Step 5: Confirm a clean dev build from scratch (the copy hooks no longer touch Python)**

```bash
cd frontend && rm -rf public/models public/ort && npm run copy-vision-assets && ls public/models public/ort
```
Expected: `public/models/pieces.onnx` and `public/ort/ort-wasm-simd-threaded.wasm` both appear, sourced entirely from inside `frontend/`.

- [ ] **Step 6: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add -A
git commit -m "chore(python): delete the superseded Python backend, scripts, tests, and packaging"
```

### Task ii.2: Fix dangling `chessmenthol/*.py` references in source comments

**Context:** Several ported TS files carry header comments naming their (now-deleted) Python source. Update them to past-tense so a future reader isn't sent to a nonexistent path. These are comment-only edits — no behavior change.

**Files (modify the header/anchor comment in each):**
- `frontend/src/core/classify.ts`
- `frontend/src/core/serialize.ts`
- `frontend/src/core/orchestrator.ts`
- `frontend/src/vision/detect.ts`
- `frontend/src/vision/pieces.ts`
- `frontend/src/vision/position.ts`
- `frontend/src/vision/tracker.ts`
- `frontend/src/lib/glyphs.ts`

- [ ] **Step 1: Find every comment reference**

```bash
cd /home/buga/Dev/ChessMenthol
grep -rn "chessmenthol/" frontend/src --include='*.ts' --include='*.svelte'
```
Expected: a handful of comment lines (e.g. `// TypeScript port of chessmenthol/analysis/classify.py`). Note each file + line.

- [ ] **Step 2: Update each to past-tense**

For each hit, change the phrasing from present "port of `chessmenthol/<path>.py`" to past "ported from the original Python `chessmenthol/<path>.py` (removed in the Svelte+Tauri migration)". Keep the same path text so the historical mapping is still greppable, just clearly marked as removed. Example — in `frontend/src/core/classify.ts`:

```ts
// TypeScript port of chessmenthol/analysis/classify.py
```
→
```ts
// Ported from the original Python chessmenthol/analysis/classify.py (removed in the Svelte+Tauri migration).
```
Apply the equivalent edit to each file from Step 1. (`pieces.test.ts` line 53 is already code, not a comment, and was repointed in Task i.1 — no comment there to change unless Step 1 surfaces one.)

- [ ] **Step 3: Verify no functional reference remains and the gate is green**

```bash
cd /home/buga/Dev/ChessMenthol
grep -rn "chessmenthol/" frontend/src --include='*.ts' --include='*.svelte' | grep -v "removed in the Svelte+Tauri migration" || echo "all references are now marked removed"
cd frontend && npx tsc -p tsconfig.app.json --noEmit && npx svelte-check --tsconfig ./tsconfig.app.json
```
Expected: `all references are now marked removed`; tsc clean; svelte-check 0/0.

- [ ] **Step 4: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/src
git commit -m "docs(comments): mark ported modules' Python sources as removed"
```

---

## Task Group iii — Packaging: app icon + `tauri.conf.json` bundle

### Task iii.1: Generate a real multi-resolution app icon

**Context:** `frontend/src-tauri/icons/icon.png` is a 110-byte placeholder. Create a new chess + menthol mark (a white chess pawn on a violet rounded square — brand violet `#863bff` — with mint-green leaves; do NOT reuse `favicon.svg`), rasterize it to a 1024² PNG with `rsvg-convert` (present on the dev box), and run `tauri icon` to emit the full platform set.

**Files:**
- Create: `frontend/src-tauri/icons/source-icon.svg` (committed source)
- Create: `frontend/src-tauri/icons/source-icon.png` (1024² rasterized source)
- Replace: the generated set under `frontend/src-tauri/icons/`

- [ ] **Step 1: Author the icon source SVG**

Create `frontend/src-tauri/icons/source-icon.svg` with this content (a clean, small-size-legible mark — geometric so it does not depend on any font; iterate on it if the rasterized result reads poorly, since this is the one place taste matters more than precision):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9a5cff"/>
      <stop offset="1" stop-color="#7414ff"/>
    </linearGradient>
    <linearGradient id="mint" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8af7d4"/>
      <stop offset="1" stop-color="#2fd39a"/>
    </linearGradient>
  </defs>
  <!-- rounded-square app tile -->
  <rect x="0" y="0" width="1024" height="1024" rx="232" fill="url(#bg)"/>
  <!-- two menthol leaves tucked behind the pawn base -->
  <g fill="url(#mint)">
    <path d="M512 742 C 408 742 332 690 300 612 C 404 596 488 636 512 742 Z"/>
    <path d="M512 742 C 616 742 692 690 724 612 C 620 596 536 636 512 742 Z"/>
    <path d="M512 742 L 512 612" stroke="#1f9e76" stroke-width="10" stroke-linecap="round" opacity="0.5"/>
  </g>
  <!-- white chess pawn, centered -->
  <g fill="#ffffff">
    <circle cx="512" cy="326" r="112"/>
    <path d="M428 432 L596 432 L624 506 L400 506 Z"/>
    <path d="M452 506 C 420 580 408 666 372 726 L 652 726 C 616 666 604 580 572 506 Z"/>
    <rect x="332" y="726" width="360" height="92" rx="30"/>
    <rect x="296" y="818" width="432" height="104" rx="40"/>
  </g>
</svg>
```

- [ ] **Step 2: Rasterize to a 1024² PNG**

```bash
cd /home/buga/Dev/ChessMenthol/frontend/src-tauri/icons
rsvg-convert -w 1024 -h 1024 source-icon.svg -o source-icon.png
file source-icon.png
```
Expected: `source-icon.png: PNG image data, 1024 x 1024, 8-bit/color RGBA`.

- [ ] **Step 3: (Visual sanity) inspect the rendered mark**

Open `frontend/src-tauri/icons/source-icon.png` (Read tool renders it). Confirm it reads as a white pawn with mint leaves on a violet tile, legible as a square app icon. If it looks wrong (overlapping shapes, leaves dominating, pawn malformed), iterate on the SVG in Step 1 and re-rasterize before continuing.

- [ ] **Step 4: Generate the platform icon set**

```bash
cd /home/buga/Dev/ChessMenthol/frontend
npx tauri icon src-tauri/icons/source-icon.png
ls -1 src-tauri/icons
```
Expected: `tauri icon` writes `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, `icon.png`, plus Windows Store logos (`Square*Logo.png`, `StoreLogo.png`) into `src-tauri/icons/`.

- [ ] **Step 5: Point `tauri.conf.json` at the generated icons**

In `frontend/src-tauri/tauri.conf.json`, set the `bundle.icon` array (the current `bundle` block has none, so the build can't find icons). Change:
```json
  "bundle": { "active": true, "targets": "all" }
```
to (full bundle finalization happens in Task iii.2; this step only adds the icon list so the icon work is self-contained and verifiable):
```json
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
```

- [ ] **Step 6: Verify the Tauri config still parses and the icons resolve**

```bash
cd /home/buga/Dev/ChessMenthol/frontend/src-tauri && cargo build
```
Expected: `cargo build` succeeds (the `tauri-build` step validates `tauri.conf.json` and the referenced icon paths exist).

- [ ] **Step 7: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/src-tauri/icons frontend/src-tauri/tauri.conf.json
git commit -m "feat(packaging): add a real chess+menthol app icon set (tauri icon)"
```

### Task iii.2: Finalize the `tauri.conf.json` bundle metadata and prove a real local build

**Context:** With icons in place, fill in the bundle metadata Tauri uses for installers (description, copyright, license, category, Linux deb dependency on WebKitGTK). Then **prove the packaging actually works** by running a full `tauri build` on this Linux box and inspecting the produced `.deb`/`.AppImage`. This is the strongest available gate for the CI workflow that follows.

**Files:**
- Modify: `frontend/src-tauri/tauri.conf.json`

- [ ] **Step 1: Fill in bundle metadata**

In `frontend/src-tauri/tauri.conf.json`, expand the `bundle` block (built on Task iii.1's icon list) to:

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "category": "Education",
    "shortDescription": "Cross-platform desktop chess assistant (engine + vision).",
    "longDescription": "ChessMenthol watches a chess board on your screen, recognizes the position, and analyzes it with Stockfish — streaming evaluations, best lines, and chess.com-style move classification. Engine, chess logic, and board vision run in WebAssembly; a thin Rust shell does only screen capture.",
    "copyright": "Copyright (C) 2026 rashidmya. GPL-3.0-or-later.",
    "licenseFile": "../../LICENSE",
    "linux": {
      "deb": {
        "depends": ["libwebkit2gtk-4.1-0", "libgtk-3-0"],
        "section": "games"
      }
    }
  }
```
Notes:
- `targets: "all"` lets each OS produce its native set: Windows → `.msi` (WiX) + `.exe` (NSIS); macOS → `.app` + `.dmg`; Linux → `.deb` + `.AppImage` + `.rpm`. The spec requires `.msi/.exe`, `.dmg/.app`, `.AppImage/.deb` — `all` is a superset and satisfies it.
- `licenseFile` is relative to `tauri.conf.json` (`frontend/src-tauri/`), so `../../LICENSE` → repo-root `LICENSE`. Verify that path exists in Step 2.
- The Wayland screenshot-CLI fallback (`spectacle`/`grim`/`gnome-screenshot`) is a **soft runtime** dep used only on wlroots-less Wayland; it is documented in the README (Task v.1), not declared as a hard `depends` (X11 users don't need it).

- [ ] **Step 2: Confirm the license path resolves**

```bash
cd /home/buga/Dev/ChessMenthol && test -f LICENSE && echo "OK: LICENSE present at repo root"
```
Expected: `OK: LICENSE present at repo root`. (If absent, change `licenseFile` to the actual license path or drop the key.)

- [ ] **Step 3: Run a real bundle build on Linux (the packaging gate)**

```bash
cd /home/buga/Dev/ChessMenthol/frontend && WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri build
```
Expected: a full release build (frontend `vite build` via `beforeBuildCommand` → Rust release compile → bundlers). This is slow (Rust release + bundling). On success, Tauri prints the artifact paths.

- [ ] **Step 4: Confirm the Linux installers were produced**

```bash
cd /home/buga/Dev/ChessMenthol/frontend/src-tauri/target/release/bundle
find . -maxdepth 2 -type f \( -name '*.deb' -o -name '*.AppImage' -o -name '*.rpm' \) -exec ls -lh {} \;
```
Expected: at least a `.deb` (under `deb/`) and an `.AppImage` (under `appimage/`) exist. This proves the bundle config is valid and the icon/metadata are accepted. (If `.AppImage` fails for environment reasons — e.g. FUSE/network in a sandbox — a successful `.deb` plus a clean `--no-bundle` compile is acceptable; note it in the commit and the CI matrix will produce the rest on clean runners.)

- [ ] **Step 5: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add frontend/src-tauri/tauri.conf.json
git commit -m "feat(packaging): finalize tauri bundle metadata + Linux deb deps (M5c)"
```

---

## Task Group iv — Release + CI workflows

> Note: these workflows activate only once the branch is pushed to a GitHub remote. They are deliverable config; the local `tauri build` in Task iii.2 already proved the build commands work on Linux. Validate them structurally with `action-validator` (npm, no install needed via `npx`).

### Task iv.1: Tag-triggered release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: '--target universal-apple-darwin'
          - platform: ubuntu-22.04
            args: ''
          - platform: windows-latest
            args: ''

    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Install Node
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Install Rust (stable)
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: ./frontend/src-tauri -> target

      - name: Install Linux build deps
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            librsvg2-dev \
            patchelf \
            libappindicator3-dev

      - name: Install frontend dependencies
        working-directory: frontend
        run: npm ci

      - name: Build and release (tauri-action)
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          projectPath: frontend
          tagName: ${{ github.ref_name }}
          releaseName: 'ChessMenthol ${{ github.ref_name }}'
          releaseBody: 'See the assets below to download and install ChessMenthol.'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```
Notes:
- `tauri-action` runs the tauri CLI from `projectPath: frontend`; it invokes `beforeBuildCommand` (`npm run build`, whose `prebuild` runs `copy-engine` + `copy-vision-assets`, staging the engine + the relocated model + the single ort wasm). It uploads each OS's installers to a **draft** Release tagged `${{ github.ref_name }}`.
- macOS builds a **universal** binary (`universal-apple-darwin`) → one `.dmg`/`.app` for both Apple Silicon and Intel.
- No code signing (no certs): artifacts are unsigned; document the Gatekeeper/SmartScreen caveat in the README (Task v.1).

- [ ] **Step 2: Validate the workflow schema**

```bash
cd /home/buga/Dev/ChessMenthol && npx --yes action-validator .github/workflows/release.yml
```
Expected: validation passes (exit 0, no schema errors). If `action-validator` is unreachable (offline), fall back to a YAML well-formedness check and a careful manual diff against the `tauri-action` README example.

- [ ] **Step 3: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add .github/workflows/release.yml
git commit -m "ci: tag-triggered 3-OS release matrix via tauri-action (draft GitHub Release)"
```

### Task iv.2: PR/push build-smoke + test workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main
      - 'feat/**'

jobs:
  test:
    name: Frontend tests + typecheck
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - name: Install Node
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - name: Install frontend dependencies
        working-directory: frontend
        run: npm ci
      - name: Vitest
        working-directory: frontend
        run: npm run test
      - name: Typecheck
        working-directory: frontend
        run: npx tsc -p tsconfig.app.json --noEmit
      - name: Svelte check
        working-directory: frontend
        run: npx svelte-check --tsconfig ./tsconfig.app.json

  build-smoke:
    name: Tauri build smoke (${{ matrix.platform }})
    needs: test
    strategy:
      fail-fast: false
      matrix:
        platform: [ubuntu-22.04, windows-latest, macos-latest]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - name: Install Node
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - name: Install Rust (stable)
        uses: dtolnay/rust-toolchain@stable
      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: ./frontend/src-tauri -> target
      - name: Install Linux build deps
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            librsvg2-dev \
            patchelf \
            libappindicator3-dev
      - name: Install frontend dependencies
        working-directory: frontend
        run: npm ci
      - name: Build (no bundle)
        working-directory: frontend
        run: npx tauri build --no-bundle
```
Notes:
- The `test` job (fast, ubuntu-only) is the always-on gate: Vitest + `tsc` + `svelte-check`.
- `build-smoke` compiles the full app + Rust shell on all three OSes with `--no-bundle` (no installers, no upload) to catch cross-platform compile breakage cheaply. It `needs: test` so a test failure skips the heavy builds.

- [ ] **Step 2: Validate the workflow schema**

```bash
cd /home/buga/Dev/ChessMenthol && npx --yes action-validator .github/workflows/ci.yml
```
Expected: validation passes (exit 0). Same offline fallback as Task iv.1 Step 2.

- [ ] **Step 3: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add .github/workflows/ci.yml
git commit -m "ci: PR/push test + 3-OS tauri build smoke"
```

---

## Task Group v — Docs + cut-over finalization

### Task v.1: Write the project README and refresh NOTICE

**Files:**
- Create: `README.md` (repo root)
- Modify: `frontend/README.md` (replace stock Vite boilerplate)
- Modify: `NOTICE.md` (third-party section)

- [ ] **Step 1: Write the root `README.md`**

Create `README.md` at the repo root:

````markdown
# ChessMenthol

A cross-platform desktop chess assistant. ChessMenthol watches a chess board on
your screen, recognizes the position with computer vision, and analyzes it with
Stockfish — streaming evaluations, best lines, and chess.com-style move
classification (brilliant / great / best / … / blunder / miss).

The engine, chess logic, move classification, and board-vision pipeline all run
in **WebAssembly** inside a **Svelte 5** UI. A thin **Tauri (Rust)** shell does
only one native thing a web page cannot: capture the screen.

## Architecture

```
Tauri shell (Rust, thin)        Renderer (Svelte 5 + TypeScript)
  capture_frame() -> RGBA   →     core/orchestrator.ts  (board, history, classify)
  (xcap; Wayland CLI fallback)    engine: stockfish.wasm  (Web Worker, UCI in TS)
                                  vision: detect.ts + onnxruntime-web (Web Worker)
                                  chess rules: chessops
```

There is no Python and no localhost server — the previous FastAPI backend and its
WebSocket protocol were removed in the Svelte + Tauri migration (see
`docs/superpowers/specs/2026-06-28-svelte-tauri-migration-design.md`).

## Prerequisites

- **Node.js** (LTS) and **npm**
- **Rust** (stable) + the [Tauri 2 system prerequisites](https://tauri.app/start/prerequisites/)
  for your OS. On Debian/Ubuntu Linux:
  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
  ```

## Develop

```bash
cd frontend
npm install
npm run tauri dev
```

The app also runs as an **analysis-only website** (no screen capture) with
`npm run dev` — vision is enabled only under the Tauri desktop shell.

### Linux / Wayland notes

- **WebKitGTK rendering:** on some Wayland compositors (e.g. KDE Plasma / KWin),
  WebKitGTK's DMABUF renderer crashes ("Gdk Error 71 Protocol error"). If the
  window fails to render, launch with:
  ```bash
  WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
  # and for a packaged build:
  WEBKIT_DISABLE_DMABUF_RENDERER=1 ./ChessMenthol
  ```
- **Screen capture:** on Wayland compositors without `wlr-screencopy`
  (KWin/Mutter), ChessMenthol shells out to a screenshot tool for capture.
  Install one of: **`spectacle`** (KDE), **`grim`** (wlroots), or
  **`gnome-screenshot`** (GNOME). X11, Windows, and macOS capture directly.

## Test

```bash
cd frontend
npm run test            # Vitest (engine, orchestrator, classify, vision parity)
npx tsc -p tsconfig.app.json --noEmit
npx svelte-check --tsconfig ./tsconfig.app.json
```

## Build installers

```bash
cd frontend
npm run tauri build
```

Produces native installers under `frontend/src-tauri/target/release/bundle/`:
Windows `.msi`/`.exe`, macOS `.dmg`/`.app`, Linux `.AppImage`/`.deb`.

> Installers are **unsigned**. macOS Gatekeeper / Windows SmartScreen will warn on
> first launch; allow the app manually (right-click → Open on macOS).

## Release

Push a version tag and CI builds + uploads all three OSes' installers to a draft
GitHub Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The matrix is defined in `.github/workflows/release.yml`; PRs and branch pushes
run `.github/workflows/ci.yml` (tests + a build-only smoke).

## License

GPL-3.0-or-later. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).
````

- [ ] **Step 2: Replace the stock `frontend/README.md`**

Overwrite `frontend/README.md` (currently the unmodified Vite+Svelte template) with a short pointer:

```markdown
# ChessMenthol — frontend (Svelte 5 + Tauri 2)

This is the ChessMenthol application: a Svelte 5 + TypeScript renderer and a thin
Tauri (Rust) shell under `src-tauri/`. The engine (stockfish.wasm), chess logic
(chessops), and board vision (onnxruntime-web) all run in the web/WASM layer.

See the [root README](../README.md) for architecture, prerequisites, and the
dev / test / build / release instructions.

- `npm run tauri dev` — run the desktop app (vision enabled)
- `npm run dev` — run as an analysis-only website (no capture)
- `npm run test` — Vitest suite
- `npm run tauri build` — produce native installers
```

- [ ] **Step 3: Refresh the NOTICE third-party section**

In `NOTICE.md`, replace the `## Third-party components` section (everything from that heading to end of file) with one that matches the new stack — Stockfish now ships as **wasm** (run in a Web Worker, not a separate executable), and chessops / onnxruntime-web / xcap / Tauri are added:

```markdown
## Third-party components

This project bundles and/or links third-party components, each under its own
license. The notable copyleft components requiring compliance are:

- **Stockfish (WASM build)** — GNU General Public License v3.0 or later.
  The chess engine, compiled to WebAssembly and run in a Web Worker via the
  `stockfish` npm package; driven over the UCI protocol in TypeScript.
  Corresponding source: <https://github.com/official-stockfish/Stockfish>

- **chessground** (`@lichess-org/chessground`) — GNU General Public License
  v3.0 or later. The board UI library linked into the web frontend.
  Corresponding source: <https://github.com/lichess-org/chessground>

- **chessops** (`chessops`) — GNU General Public License v3.0 or later.
  Chess move generation, SAN/FEN, and game-outcome logic.
  Corresponding source: <https://github.com/niklasf/chessops>

Permissively-licensed components (informational):

- **Tauri** (`tauri`, `@tauri-apps/api`) — Apache-2.0 OR MIT. The desktop shell.
- **xcap** — Apache-2.0. Screen capture in the Rust shell.
- **onnxruntime-web** — MIT. Runs the bundled `pieces.onnx` piece classifier.

The `pieces.onnx` model (`frontend/models/pieces.onnx`) is a project artifact
bundled as-is.
```

- [ ] **Step 4: Verify the docs are coherent (no stale references)**

```bash
cd /home/buga/Dev/ChessMenthol
grep -rn -e "FastAPI\|uvicorn\|WebSocket\|python-chess\|PyInstaller\|127.0.0.1:8765" README.md frontend/README.md NOTICE.md || echo "no stale Python-era references in docs"
```
Expected: `no stale Python-era references in docs`.

- [ ] **Step 5: Commit**

```bash
cd /home/buga/Dev/ChessMenthol
git add README.md frontend/README.md NOTICE.md
git commit -m "docs: project README + refreshed NOTICE for the Svelte+Tauri stack"
```

### Task v.2: Final human verification (the Phase-3 ship gate)

**Context:** Mirrors Phase 2's `vi.2` manual gate. Automated gates can't catch desktop-runtime regressions (the four vi.2 issues were all runtime-only). The user runs this; the agent prepares the checklist and the build.

- [ ] **Step 1: Re-run the full automated gate one last time**

```bash
cd /home/buga/Dev/ChessMenthol/frontend && npm run test \
  && npx tsc -p tsconfig.app.json --noEmit \
  && npx svelte-check --tsconfig ./tsconfig.app.json \
  && ( cd src-tauri && cargo build )
```
Expected: all green (≥381 tests).

- [ ] **Step 2: Build the desktop app and hand it to the user**

```bash
cd /home/buga/Dev/ChessMenthol/frontend && WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri build
```
Surface the produced `.deb`/`.AppImage` paths (and/or run `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev` for a live check).

- [ ] **Step 3: Present the manual checklist to the user**

Ask the user to confirm in the running desktop app:
1. **App identity:** the window/taskbar shows the new chess+menthol icon (not the placeholder).
2. **Analysis path:** edit a FEN / make moves → analysis streams, eval + lines + move classification appear, play-best works, navigation + game-over work.
3. **Vision path:** region-select → drag → Capture → board updates from the screen; detected orientation follows; low-confidence squares highlight (the Phase-2 parity surface still works end-to-end).
4. **No regressions** from the Python deletion (the app launches and runs with zero reference to any removed backend).

- [ ] **Step 4: (After the user confirms) record completion**

On user sign-off, the migration is complete: Python is gone, packaging + CI ship the three OSes, M5c is done. Update the `svelte-tauri-migration` memory to mark Phase 3 DONE (and note that the branch is still unmerged per the standing decision, awaiting the user's merge call).

---

## Self-review (against spec §8 + §9)

- **§9 "Delete all Python (`chessmenthol/` package, `pyproject.toml` server bits, `scripts/fetch_engines.py`)"** → Group ii (ii.1 deletes the package, scripts incl. `fetch_engines.py` + `convert_pieces_model.py`, tests, `pyproject.toml`, egg-info). The kickoff's "keep the committed test FIXTURES (board/piece PNGs, ground_truth.json, pieces.onnx)" → Task i.1 relocates `pieces.onnx` into `frontend/models/`; the 31 fixture files were already committed under `frontend/src/tests/fixtures/vision/` (verified) and are untouched. ✓
- **§8 / §9 "finalize `tauri.conf.json` + CI packaging for the three OSes; M5c complete"** → Group iii (icon + bundle metadata, gated by a real local `tauri build`) + Group iv (release.yml tag→3-OS draft Release; ci.yml smoke). Spec's required targets (`.msi/.exe`, `.dmg/.app`, `.AppImage/.deb`) covered by `targets: "all"`. ✓
- **Carry-over: ort bloat** → Task i.2 (copy only the 13.5 MB wasm; prune the dead dist bundle). ✓
- **Carry-over: real app icons** → Task iii.1. ✓
- **Carry-over: `WEBKIT_DISABLE_DMABUF_RENDERER` handling** → decision = document only → README Linux/Wayland section (Task v.1), no Rust change. ✓
- **Carry-over: region dimmed backdrop** → decision = out of scope → intentionally no task. ✓
- **Type/path consistency:** the relocated model path `frontend/models/pieces.onnx` is used identically in Task i.1 (Step 1 `git mv`, Step 2 `copy-vision-assets.mjs` `MODEL_SRC`, Step 3 `pieces.test.ts` `MODEL`), Task ii.1 (Step 1 guard), and NOTICE (Task v.1). The single runtime wasm `ort-wasm-simd-threaded.wasm` is named identically in Task i.2 and the prune script. ✓
- **Ordering safety:** Group i (decouple) fully precedes Group ii (delete); ii.1 Step 1 is an explicit guard that aborts if decoupling is incomplete. ✓

## Out of scope (explicit)

- Merging to `main` (standing decision: keep stacking on `feat/svelte-tauri-migration`).
- Code signing / notarization (no certificates; documented as unsigned).
- The region-select dimmed backdrop (dropped per decision 4).
- The variation tree (Spec 2) and any feature beyond parity.
