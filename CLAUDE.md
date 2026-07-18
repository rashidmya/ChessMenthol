# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ChessMenthol is a cross-platform desktop chess assistant. It watches a chess board on your
screen, recognizes the position with computer vision, and analyzes it with Stockfish —
streaming evaluations, best lines, and chess.com-style move classification (brilliant /
great / best / … / blunder / miss).

The chess logic and computer vision run inside a **Svelte 5 + TypeScript** renderer (vision in
**Web Workers / WebAssembly** via onnxruntime-web). A thin **Tauri 2 (Rust)** shell does only
what a web page cannot: capture the screen and bridge to a **native UCI engine process**. There
is **no backend server** — no localhost, no WebSocket; the renderer drives the core in-process
(the `send`/store surface just mirrors a network protocol).

ChessMenthol is **desktop-only**: analysis (native engine) and screen capture both require the
Tauri shell. The Svelte renderer still loads in a plain browser via `npm run dev` for fast UI
iteration — but with no engine and no capture. Those paths stay guarded by `isTauri()` /
`hasNativeCapture()`.

## Commands

This is an **npm workspace monorepo**: the root `package.json` declares workspaces `packages/*`
and `apps/*` — i.e. `packages/core` (`@chessmenthol/core`), `apps/desktop` (the Tauri app), and
`apps/extension` (the browser extension). Run `npm install` / `npm ci` **from the repo root** — it
installs and hoists all three. Shared chess/engine/vision logic lives in **`@chessmenthol/core`**
(TS-only, **source-only** — no build step; consumers' bundlers compile its `.ts` via
`exports: { "./*": "./src/*.ts" }`). Both `apps/desktop` and `apps/extension` import it as
`@chessmenthol/core/<dir>/<file>`.

```bash
npm install                                # from the repo ROOT — installs all workspaces
npm test --workspace @chessmenthol/core    # shared-core vitest suite
npm test --workspace chessmenthol-extension  # extension vitest suite

cd apps/desktop
node scripts/fetch-sidecar.mjs  # ONE-TIME per checkout: provision the native Stockfish sidecar
npm run tauri dev     # desktop app (Tauri + WebKit) — vision + native engine enabled
npm run dev           # renderer in a plain browser (UI only) — no vision, no engine

npm run test          # app Vitest (component / Tauri / integration cases)
npm run check         # svelte-check + tsc -p tsconfig.node.json
npx tsc -p tsconfig.app.json --noEmit          # app type-check only
npx svelte-check --tsconfig ./tsconfig.app.json

npm run tauri build   # native installers -> src-tauri/target/release/bundle/
```

Run a single test file or case:

```bash
npx vitest run src/tests/classify.test.ts
npx vitest run -t "brilliant"        # by test-name substring
```

**Linux / Wayland:** if the desktop window fails to render (WebKitGTK DMABUF crash, "Gdk Error
71"), prefix with `WEBKIT_DISABLE_DMABUF_RENDERER=1`, e.g.
`WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`. Screen capture on KWin/Mutter Wayland
shells out to a screenshot CLI — install `spectacle`, `grim`, or `gnome-screenshot`.

The `predev`/`prebuild` hook runs `scripts/copy-vision-assets.mjs`, which stages the ONNX
vision assets into `public/`. If the model fails to load in dev, re-run
`npm run copy-vision-assets`.

`tauri dev`/`tauri build` bundle a **native Stockfish sidecar** (`externalBin binaries/stockfish-<triple>`
+ the NNUE net under `resources/engine/`). Those files are **gitignored** (large, native, per-platform),
so a fresh checkout must provision them once with **`node scripts/fetch-sidecar.mjs`** (host triple by
default; pass explicit triples for cross-builds) — otherwise the Rust build fails with
`resource path 'binaries/stockfish-…' doesn't exist`. It is NOT wired into `npm run tauri build` (CI runs
it as its own step, `release.yml`); run it yourself once. The binary persists on disk, so later builds
don't re-fetch.

Local Linux `tauri build`: `.deb` + `.rpm` bundle fine, but the **AppImage** step (`linuxdeploy`) fails
with `failed to run linuxdeploy` in sandboxes/containers where its bundled AppImage tools can't
FUSE-mount (even when `/dev/fuse` exists). Prefix with **`APPIMAGE_EXTRACT_AND_RUN=1`** (extract instead
of mount) to build all three, or `npm run tauri build -- --bundles deb,rpm` to skip AppImage. On modern
rolling distros (Arch/CachyOS) `linuxdeploy` *also* fails at the strip step — its bundled `strip` can't
parse the `.relr.dyn` (packed relative relocations) in current system libs (`unknown type [0x13] section
.relr.dyn`) — so add **`NO_STRIP=1`** as well. CI (Ubuntu 24.04) needs neither env var.

## Architecture

### The command → frame loop (start here)

UI never touches the engine or board directly. It calls `send(command)` and reads reactive
stores. `apps/desktop/src/lib/engineClient.ts` is the hub: it owns the Svelte stores (`state`,
`report`, `regionShot`, `lastError`, …), instantiates the `Orchestrator`, and routes emitted
frames back into those stores. The `send(Command)` / store surface deliberately mirrors a
network protocol even though everything is in-process.

- **Commands** and **frames** (the whole UI↔core contract) are the discriminated unions in
  `apps/desktop/src/lib/types.ts` — `Command`, `ServerFrame` (`StateFrame | ReportFrame |
  RegionShotFrame | ErrorFrame`), and the DTO shapes.
- `packages/core/src/core/orchestrator.ts` is the state machine: it owns the working board,
  settings, analysis session, and vision tracker; turns each command into new `StateFrame`s.

`App.svelte` is a single-board app with screens `home | analysis | edit | report | review`
(`type Screen` in `App.svelte`), all sharing one board and the store surface above.

### `@chessmenthol/core` (`packages/core/src`) — the shared chess/engine/vision code

Lives in the workspace package, **not** `apps/desktop/src` (extracted so the browser extension can reuse
it). `core/` (`orchestrator.ts`, `chess.ts`, `classify.ts`, `serialize.ts`, `pgn.ts`,
`accuracy.ts`, `report.ts`), the `engine/` seam (`engine.ts`, `session.ts`, `uci.ts`,
`uciOptions.ts`, `types.ts`), the `vision/` pipeline (`detect coords pieces position tracker
types visionClient`), and shared `lib/` (`types region board arrows edit evalbar licon
engineRegistry image` + the `engineOptions` override store). Two rules that the tests enforce:

- **All chess logic goes through `core/chess.ts`** (which wraps the `chessops` library).
  Do not import `chessops` anywhere else.
- **The tests in `packages/core/src/tests/` are the executable spec** (its own vitest suite).
  When changing classification / accuracy / serialization, expect a test that pins the exact
  Lichess/chess.com-parity numbers — change a pinned number only when you mean to, and keep the
  suite green. (Component/Tauri/integration tests stay in `apps/desktop/src/tests`.)

Gotcha: **movetime is milliseconds throughout the TS code.** See the header comment in
`orchestrator.ts` for the runtime model — chessops immutable positions rebuilt by replaying
move history.

### `engine/` — UCI plumbing

The seam + parsers live in `@chessmenthol/core`; the Tauri implementation stays in `apps/desktop/src`.

- `engine.ts` — the `UciEngine` seam (text-in / line-out) + `applyOptions`; the desktop
  implementation is `apps/desktop/src/engine/nativeEngine.ts` (the extension supplies its own WASM one).
- `apps/desktop/src/engine/nativeEngine.ts` — the `UciEngine`, backed by a native process over Tauri IPC
  (`engine_start` / `engine_send` / `engine_stop`): the bundled Stockfish **sidecar** or a
  user's **external** binary (`EngineSpec = { kind: 'bundled' } | { kind: 'external', path }`).
- `session.ts` — `AnalysisSession` runs **one search at a time** with explicit `draining`
  semantics: to supersede a search it sends `stop` and waits for the stopped search's trailing
  `bestmove` (not `readyok`). Read the class comment before touching search lifecycle.
- `uci.ts` / `uciOptions.ts` — UCI line parsing and the engine-options schema (the sole parser).

**Native engine only:** the app runs one native UCI process over Tauri IPC — there is no
in-webview wasm/asm Stockfish. (WebKitGTK, the Linux Tauri webview, can't run threaded-SIMD
wasm and can even SIGSEGV instantiating the NNUE wasm, which is why the wasm path was dropped.)
`@chessmenthol/core/lib/engineRegistry` owns the user's engine list (bundled Stockfish +
persisted "bring-your-own" external binaries); `@chessmenthol/core/lib/engineOptions` is the
per-engine schema/override localStorage store, while the Tauri probe that populates a schema
(`ensureSchema`, `invoke('engine_probe')`) stays desktop-side in `apps/desktop/src/lib/engineSchema.ts`.

### `vision/` — board recognition (Tauri only)

Runs in `vision-worker.ts` (a Web Worker), driven from the main thread via
`visionClient.ts` (`VisionWorkerClient` / `VisionTracker`). Pipeline: `detect.ts` (axis-aligned
board detection via edge profiles + autocorrelation — pure array math, no
OpenCV) → `pieces.ts` (ONNX piece classifier via `onnxruntime-web`) → `position.ts` (assemble a
FEN) → `tracker.ts` (temporal stabilization). Orientation is resolved in the tracker as
`override ?? readOrientationFromLabels (coords.ts, reads the board's rank labels via
ink-density) ?? guessOrientation (pieces) ?? hint`; the user override is driven by the
`set_board_side` command (the Board side: Auto/White/Black selector in the capture
region overlay, `RegionOverlay`, chosen before the capture fires). A
180°-rotated position is itself legal, so the coordinate labels — not the pieces — are what
disambiguate a sparse Black-side board. Side-to-move on a fresh capture is inferred from the
last-move highlight: `detect.ts` finds it as the two strongest **warm-tinted** cells sampled at
their corners (so a piece on the destination doesn't wash out the overlay, and saturated-red
check/premove highlights are dropped (warm oranges can slip through)), and `guessSideToMove`
(`position.ts`) trusts it only when exactly one of
the pair is occupied — the mover — else it falls back to White + the manual `TurnToggle`. The
Rust `capture_frame` returns raw RGBA with an
8-byte little-endian `[width][height]` header over binary IPC; the pure decode/crop helpers
live in `@chessmenthol/core/lib/image`, driven by `apps/desktop/src/lib/capture.ts`'s Tauri `Capturer`.

### `src-tauri/` — the thin Rust shell

`lib.rs` registers exactly these commands: `capture_frame` (full-desktop RGBA; direct `xcap`
grab on X11/Windows/macOS, screenshot-CLI fallback on Wayland) plus the `engine::*` bridge in
`engine.rs` (spawns/streams one native UCI process; kills it on app exit). Nets and the bundled
Stockfish binary live under `src-tauri/binaries/` and `src-tauri/resources/engine/`.

**AppImage env gotcha:** the Wayland screenshot fallback shells out to a **system** binary
(spectacle/grim/gnome-screenshot). Inside an AppImage, `AppRun` exports `LD_LIBRARY_PATH`
(+ GTK/GIO/GSettings module paths) into the bundle, which a spawned system tool would inherit —
loading the bundle's older `libwayland-client` and dying with `undefined symbol:
wl_display_create_queue_with_name`. So spawn system helpers via `system_command()`, which strips
those vars (`APPIMAGE_ENV_VARS`). Any new `Command::new(...)` for a system binary must go through it.

### UI (`components/`)

All components are **Svelte 5 on the legacy API** — `export let` props, `$:` reactive
statements, `on:click`. **Do not introduce runes** (`$state`/`$props`/etc.); match the
surrounding component. `App.svelte` is the top-level composition; the rest are presentational,
driven by props + the `engineClient` stores.

**Component-drift caveat:** `@chessmenthol/core` is TS-only, so the 4 components the browser
extension also renders — `Board`/`EvalBar`/`Lines`/`Icon.svelte` — are **duplicated**: the
originals in `apps/desktop/src/components` and copies in `apps/extension/entrypoints/sidepanel/components`
(both import their logic from `@chessmenthol/core`). Edit both copies together.

Two shared "single source of truth" abstractions to reuse rather than re-derive:

- **Icons** — `<Icon name="…" />` (`components/Icon.svelte`) renders a glyph from Lichess's
  vendored icon webfont. Names are keys of `lib/licon.ts` (the verbatim Lichess `licon`
  name→PUA-codepoint map); the font + `[data-icon]::before` rule live in `app.css`. Pass
  `label` only for a standalone meaningful icon (→ `role="img"`); omit it for decorative icons
  next to text. `assets/fonts/chess-figurine.woff2` separately renders figurine notation.
- **Move-quality badges** — the 10-class taxonomy (`brilliant, great, best, excellent, good,
  book, inaccuracy, mistake, blunder, miss`, `MoveClass` in `core/classify.ts`) maps to a
  glyph + color in exactly one place: `lib/glyphs.ts` `glyphFor(label)` and `lib/moveclass.ts`
  `moveColor`. `components/MoveBadge.svelte` renders from a label; the board, move list,
  feedback card, and report summary all go through it. Note: `book` never fires in the report
  batch (no opening book wired in), so its count reads 0 by design.

## Conventions & gotchas

- **Cross-origin isolation** is required by `onnxruntime-web` (the vision worker):
  `vite.config.ts` sets COOP `same-origin` + COEP `require-corp`, and `onnxruntime-web` is in
  `optimizeDeps.exclude`. Don't drop these.
- **Guard Tauri-only paths** so the renderer still loads in a plain browser for UI work:
  capture, region select, and the native engine are all behind `isTauri()` /
  `hasNativeCapture()` (in a browser, requesting analysis rejects with a "desktop app required"
  error). Vision handlers in the orchestrator degrade gracefully (re-emit state, never throw)
  when no tracker is injected.
- **Tests are the spec.** Classification, accuracy, and serialization changes must keep the
  parity numbers pinned in `src/tests/`.
- **Responsive layout** reflows the desktop UI into a single vertical scroll below **819.98px**
  (phone/tablet-portrait / small window). The breakpoint lives in four places that MUST stay in
  sync: `lib/viewport.ts` (`NARROW_MAX` + the `isNarrow` matchMedia store), and `@media
  (max-width: 819.98px)` blocks in `app.css`, `App.svelte`, and `MoveHistory.svelte`. Pure-CSS
  reflow is verified by the **manual desktop gate** (jsdom can't evaluate media queries); only
  the DOM relocations CSS can't express (nav arrows move under the board, eval bar goes
  horizontal) are driven by `isNarrow`. Touch sizing uses `@media (pointer: coarse)`.
- **License is GPLv3** (see `NOTICE.md`). Vendored Lichess assets (icon font, figurine font)
  are AGPL/GPL — add an attribution entry to `NOTICE.md` when vendoring more.

## Development workflow

- Features are built **plan-driven and TDD-first**: each task writes a failing test,
  implements, then commits. Tests live in `src/tests/*.test.ts` (Vitest +
  @testing-library/svelte, jsdom). Components are queried by `data-testid` / role / text —
  preserve those hooks when editing.
- `npm run check` (svelte-check + tsc) is expected to report **0 errors, 0 warnings**; keep it
  green alongside `npm test`.
- Active development is on the `feat/svelte-tauri-migration` branch (the effective main).
  Commit trailer used in this repo:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Several features still have a **pending manual desktop pass** (a human gate) beyond the green
  automated suite — verify vision/engine/icon rendering under
  `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev` before declaring UI/desktop work done.
- **Desktop releases** are cut by pushing a `v*` tag (`.github/workflows/release.yml` →
  `tauri-action` builds the 3-platform matrix and drafts a GitHub release with **auto-generated
  notes**, `generateReleaseNotes: true`). Those notes list **merged pull requests** in the tag
  range, so land release-worthy work via **PRs** — commits pushed straight to `main` show up only
  in the `Full Changelog` compare link, never as changelog entries.
- **Extension releases are separate** — pushing an `ext-v*` tag (e.g. `ext-v0.1.0`) runs
  `.github/workflows/release-extension.yml`, which gates on the extension's vitest + svelte-check,
  builds the Chrome/Firefox zips via `wxt zip` (the ORT-prune runs in a WXT `build:done` hook, so
  `wxt build` and `wxt zip` both drop the dead ~13.5 MB ort wasm), and drafts its **own** GitHub
  release with those zips. The tag version must match `apps/extension/package.json` (the workflow
  fails otherwise). `workflow_dispatch` runs the same build but only uploads artifacts (no release).
  `ext-v*` never matches the desktop's `v*` glob, so the two release cards stay independent.

## Maintaining this file

Keep this file accurate as the codebase changes — it is the first thing future agents read.
When your work makes something here wrong or incomplete, update it in the same change:

- **Update** a description when you alter an architecture boundary, command, config, or
  convention it documents (e.g. a new `Command`/frame, a renamed core module, a build-step or
  engine-preset change).
- **Add** a short entry when you introduce a subsystem or convention a future agent could not
  cheaply discover by reading the code.
- **Remove** anything you delete or obsolete (e.g. a dropped screen, a retired module, a
  resolved gotcha) — a stale pointer is worse than none.

Keep it high-level and non-obvious: no exhaustive file listings, no generic advice, no
duplicating what the code or `README.md` already states plainly. If a claim here contradicts
the code, trust the code and fix the file.
