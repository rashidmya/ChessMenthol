# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ChessMenthol is a cross-platform desktop chess assistant. It watches a chess board on your
screen, recognizes the position with computer vision, and analyzes it with Stockfish —
streaming evaluations, best lines, and chess.com-style move classification (brilliant /
great / best / … / blunder / miss).

Everything except screen capture runs in **WebAssembly / Web Workers** inside a **Svelte 5 +
TypeScript** renderer. A thin **Tauri 2 (Rust)** shell does only what a web page cannot:
capture the screen and bridge to a native UCI engine process. There is **no Python and no
localhost server** — the previous FastAPI backend and its WebSocket protocol were removed in
the Svelte + Tauri migration.

The app also runs as an **analysis-only website** (no screen capture, no native engine) — the
same renderer, minus the Tauri-only features. Guard native features with `isTauri()` /
`hasNativeCapture()`.

## Commands

All commands run from `app/` (that is the npm project root; the repo root has no
package.json).

```bash
cd app
npm install

npm run tauri dev     # desktop app (Tauri + WebKit) — vision + native engine enabled
npm run dev           # analysis-only website in the browser — no vision, no native engine

npm run test          # Vitest (run mode). ~600 cases across src/tests/
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

`predev`/`prebuild` hooks run `scripts/copy-engine.mjs` and `scripts/copy-vision-assets.mjs`,
which stage the Stockfish builds and ONNX vision assets into `public/`. If the engine or model
fails to load in dev, re-run `npm run copy-engine` / `npm run copy-vision-assets`.

## Architecture

### The command → frame loop (start here)

UI never touches the engine or board directly. It calls `send(command)` and reads reactive
stores. `app/src/lib/engineClient.ts` is the hub: it owns the Svelte stores (`state`,
`report`, `regionShot`, `lastError`, …), instantiates the `Orchestrator`, and routes emitted
frames back into those stores. It is a drop-in replacement for the old WebSocket client
(`ws.ts`), so the `send(Command)` / store surface deliberately mirrors a network protocol even
though everything is in-process.

- **Commands** and **frames** (the whole UI↔core contract) are the discriminated unions in
  `app/src/lib/types.ts` — `Command`, `ServerFrame` (`StateFrame | ReportFrame |
  RegionShotFrame | ErrorFrame`), and the DTO shapes.
- `app/src/core/orchestrator.ts` is the state machine: it owns the working board,
  settings, analysis session, and vision tracker; turns each command into new `StateFrame`s.

`App.svelte` is a single-board app with screens `home | analysis | edit | report | review`
(`type Screen` in `App.svelte`), all sharing one board and the store surface above.

### `core/` — parity-ported chess logic (WASM-side, pure TS)

`orchestrator.ts`, `chess.ts`, `classify.ts`, `serialize.ts`, `pgn.ts`, `accuracy.ts`,
`report.ts`. These are **line-by-line ports of the original Python** (`chessmenthol/server/*`,
`chessmenthol/vision/*`), which was deleted in the migration. Two rules that the tests enforce:

- **All chess logic goes through `core/chess.ts`** (which wraps the `chessops` library).
  Do not import `chessops` anywhere else.
- **The ports must stay at parity with the removed Python**, and the tests in `src/tests/` are
  the executable spec. When changing classification / accuracy / serialization, expect a test
  that pins the exact Lichess/chess.com-parity numbers.

Gotcha carried over from the port: **movetime is milliseconds throughout the TS code** (the
Python stored seconds). See the header comment in `orchestrator.ts` for the runtime-model
mapping (python-chess `Board` → chessops immutable positions rebuilt by replaying history).

### `engine/` — UCI plumbing

- `engine.ts` — loads `stockfish.wasm` in a Web Worker (`WorkerEngine`), applies options,
  detects `SharedArrayBuffer` for threaded vs single-threaded.
- `nativeEngine.ts` — same `UciEngine` contract but backed by a native process over Tauri IPC
  (`engine_start` / `engine_send` / `engine_stop`): the bundled Stockfish **sidecar** or a
  user's **external** binary (`EngineSpec = { kind: 'bundled' } | { kind: 'external', path }`).
- `session.ts` — `AnalysisSession` runs **one search at a time** with explicit `draining`
  semantics: to supersede a search it sends `stop` and waits for the stopped search's trailing
  `bestmove` (not `readyok`). Read the class comment before touching search lifecycle.
- `uci.ts` / `uciOptions.ts` — UCI line parsing and the engine-options schema (the sole parser).

**Why two engine backends:** WebKitGTK (the Tauri webview on Linux) cannot run threaded-SIMD
wasm, and can even SIGSEGV instantiating the NNUE wasm. So the desktop app prefers the **native
engine**; the browser build uses the wasm worker. In the browser there are two wasm presets —
**Stockfish Lite** (~7 MB, default) and **full Stockfish** (~108 MB NNUE, loaded on demand;
the worker reloads on switch). `lib/engineRegistry.ts` owns the user's engine list (bundled +
persisted "bring-your-own" external binaries); `lib/engineOptions.ts` caches per-engine option
schemas and overrides.

### `vision/` — board recognition (Tauri only)

Runs in `vision-worker.ts` (a Web Worker), driven from the main thread via
`visionClient.ts` (`VisionWorkerClient` / `VisionTracker`). Pipeline: `detect.ts` (axis-aligned
board detection via edge profiles + autocorrelation — a pure-array-math port of the Python, no
OpenCV) → `pieces.ts` (ONNX piece classifier via `onnxruntime-web`) → `position.ts` (assemble a
FEN) → `tracker.ts` (temporal stabilization). The Rust `capture_frame` returns raw RGBA with an
8-byte little-endian `[width][height]` header over binary IPC; `lib/capture.ts` decodes and
crops it.

### `src-tauri/` — the thin Rust shell

`lib.rs` registers exactly these commands: `capture_frame` (full-desktop RGBA; direct `xcap`
grab on X11/Windows/macOS, screenshot-CLI fallback on Wayland) plus the `engine::*` bridge in
`engine.rs` (spawns/streams one native UCI process; kills it on app exit). Nets and the bundled
Stockfish binary live under `src-tauri/binaries/` and `src-tauri/resources/engine/`.

### UI (`components/`)

All components are **Svelte 5 on the legacy API** — `export let` props, `$:` reactive
statements, `on:click`. **Do not introduce runes** (`$state`/`$props`/etc.); match the
surrounding component. `App.svelte` is the top-level composition; the rest are presentational,
driven by props + the `engineClient` stores.

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

- **Cross-origin isolation is required** for threaded Stockfish: `vite.config.ts` sets COOP
  `same-origin` + COEP `require-corp`, and `onnxruntime-web` is in `optimizeDeps.exclude`.
  Don't drop these.
- **Guard Tauri-only paths** so the analysis-only website keeps working: capture, region
  select, and the native engine are all behind `isTauri()` / `hasNativeCapture()`. Vision
  handlers in the orchestrator degrade gracefully (re-emit state, never throw) when no tracker
  is injected.
- **Tests are the spec.** Classification, accuracy, and serialization changes must keep the
  parity numbers pinned in `src/tests/`.
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
