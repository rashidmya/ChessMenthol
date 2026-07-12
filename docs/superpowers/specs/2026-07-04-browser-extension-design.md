# ChessMenthol Browser Extension — Design

- **Date:** 2026-07-04
- **Status:** Approved (brainstorm) — ready for implementation planning
- **Worktree / branch:** `.claude/worktrees/browser-extension` on `worktree-browser-extension`
- **Supersedes / relates to:** the Tauri desktop app is unchanged; this adds a *third shell* over the same core.

## 1. Goal

Ship a **cross-browser (Chrome + Firefox) extension** that reconstructs the chess board on
whatever page the user is looking at and shows live Stockfish analysis in a **side panel**,
reusing ChessMenthol's existing vision pipeline and chess core wholesale.

One line: *toolbar icon → read the board (DOM where we can, screenshot+vision everywhere
else) → reconstructed board + live engine analysis in a side panel.*

## 2. Approved decisions

| Decision | Choice |
|---|---|
| **Board source** | **Hybrid** — DOM adapter for known sites (chess.com, lichess) with exact FEN; `tabs.captureVisibleTab` + the existing vision pipeline as the universal fallback. |
| **Engine** | **Stockfish WASM in-extension.** No native install; runs in the side panel (cross-origin-isolated). |
| **UI surface** | **Side panel** (Chrome `sidePanel`, Firefox `sidebar_action`). |
| **Liveness** | **Live auto-update on DOM sites** (observe the DOM, re-analyze each move); **on-demand capture** on vision sites (button / hotkey), because `captureVisibleTab` is ~1 fps and vision inference is heavy. |
| **Browsers** | **Chrome + Firefox**, both MV3. |
| **Code organization** | **Monorepo reuse** — extract the platform-neutral code into a shared workspace package that both the desktop app and the extension import (one source of truth, one test suite). |

## 3. Non-goals (deferred to later versions)

- **Move-classification badges** (brilliant…blunder). Needs reliable move *history*; we have it
  on DOM sites but not from a single vision snapshot. Revisit after MVP.
- **Full game review / accuracy% / ACPL / PGN import.**
- **Engine-options panel / bring-your-own engine** (WASM-only in a browser).
- **Offscreen-document background analysis** (analyze while the panel is closed). MVP runs the
  engine in the panel while it is open.
- **Adapters beyond chess.com + lichess.** Everything else is covered by the vision fallback.

## 4. Architecture

### 4.1 The reuse story (why this is mostly a new shell, not a rewrite)

The desktop app was built with the right seams; the extension is a second platform shell over
the same core, exactly analogous to `src-tauri/`.

| Existing module | In the extension |
|---|---|
| `core/` (chess, classify, serialize, accuracy, **orchestrator**) — pure TS | **Reused unchanged.** |
| `vision/` (detect → pieces → position → tracker → coords) — pure TS + `onnxruntime-web` in a Worker | **Reused unchanged.** |
| `engine/engine.ts` — the `UciEngine` seam (`send` / `onLine` / `dispose` / `options`) + `session.ts`, `uci.ts`, `uciOptions.ts` | **Seam + parsing reused.** New backend `wasmEngine.ts` implements `UciEngine`. |
| `engine/nativeEngine.ts` (Tauri IPC process) | **Replaced** by `wasmEngine.ts` (Stockfish WASM worker). |
| `lib/capture.ts` `Capturer` (`invoke('capture_frame')` → `RgbaImage`) | **Replaced** by `TabCapturer` (`captureVisibleTab` → `RgbaImage`), same `RgbaImage` output the vision worker already consumes. |
| Svelte UI components (chessground board, eval bar, best lines, arrows) | **Reused,** restyled for a narrow panel. |
| `lib/engineClient.ts` — the platform hub that wires engine + tracker into `new Orchestrator(...)` | **Re-implemented** for the browser (WASM engine factory + `TabCapturer` + DOM-adapter source). |

The only genuinely new engine work is swapping the Tauri native-process backend for a WASM one
**behind the same `UciEngine` interface**.

### 4.2 Components (each has one job)

**Host tab** — the page the user is on (a site with a live board, or a video/stream/app
showing one).

**Content-script adapter** *(new)* — injected on known sites. Reads the board straight from the
DOM and emits an `AdapterPosition { fen, orientation, turn, lastMove? }`. Observes DOM mutations
and re-emits on each move. One module per site behind a shared `SiteAdapter` interface.

**Tab capturer** *(new)* — `browser.tabs.captureVisibleTab()` → data URL → decode via
`createImageBitmap` + `OffscreenCanvas.getImageData` → `RgbaImage`. Drop-in replacement for the
desktop `Capturer`; the existing `VisionTracker` / `VisionWorkerClient` sit on top unchanged.

**Vision worker** *(reused)* — `detect → pieces (ONNX) → position → tracker` ⇒ FEN. Runs in a
Web Worker inside the panel context (benefits from cross-origin isolation where available).

**Side panel** *(new shell page, reused UI + core)* — a **cross-origin-isolated** extension page
hosting the Svelte UI, the Orchestrator, the vision worker, and the Stockfish WASM worker.

**Stockfish WASM worker** *(new backend)* — implements `UciEngine`. **Single-threaded build is
the guaranteed baseline** (no `SharedArrayBuffer` needed, works in both browsers everywhere);
**multithreaded build opts in only when `crossOriginIsolated === true`.** This sidesteps
cross-browser SAB differences.

**Service worker / background** *(new)* — MV3 coordinator: wires the toolbar icon to open the
panel, brokers messages between the content-script adapter and the panel, and tells the panel
which tab is active.

### 4.3 Data flow

```
Known site (DOM path)                    Any page (vision path, on demand)
─────────────────────                    ─────────────────────────────────
content-script adapter                   panel: captureVisibleTab()
  reads DOM → AdapterPosition               → RgbaImage
  observes mutations                        → vision worker (detect…tracker)
      │  runtime message                    → FEN
      ▼                                          │
   ┌──────────────────── Side panel ───────────▼──────────────┐
   │  Orchestrator (core)  →  Stockfish WASM (UciEngine)       │
   │  chessground board · eval bar · best line · best arrow    │
   └───────────────────────────────────────────────────────────┘
```

Both paths converge on **a FEN + orientation + side-to-move** handed to the Orchestrator — the
same input the desktop app's vision tracker produces today.

### 4.4 Cross-browser strategy

- **Build tool: WXT** (Vite-based, first-class cross-browser MV3, Svelte support, unified
  `browser.*` API, generates per-browser manifests). Matches the existing Vite/Svelte stack.
- **Panel surface abstraction:** `sidePanel` on Chrome, `sidebar_action` on Firefox, behind one
  internal "panel" concept. WXT emits the right manifest per target.
- **Background:** service worker (Chrome) / event page (Firefox) — both supported by WXT.
- **Engine portability:** single-threaded WASM baseline guarantees identical behavior on both;
  multithreaded is a per-context upgrade gated on `crossOriginIsolated`.
- **Cross-origin isolation:** MV3 manifest keys `cross_origin_embedder_policy: require-corp` +
  `cross_origin_opener_policy: same-origin` on the extension pages (verified in Chrome docs);
  this also satisfies `onnxruntime-web`'s isolation requirement for its threaded build.

## 5. Interfaces (the seams that keep units independent)

```ts
// New — one per known site; the only site-specific code in the project.
interface SiteAdapter {
  matches(url: string): boolean;
  readPosition(): AdapterPosition | null;      // parse current DOM
  observe(onChange: () => void): () => void;    // fire on each move; returns unsubscribe
}
interface AdapterPosition { fen: string; orientation: Orientation; turn: 'w' | 'b'; lastMove?: [string, string]; }

// Reused verbatim — the WASM engine implements this.
interface UciEngine { send(cmd: string): void; onLine(cb: (line: string) => void): void; dispose(): void; options?: UciOption[]; }

// Reused — the tab capturer produces exactly this for the vision worker.
interface RgbaImage { data: Uint8ClampedArray; width: number; height: number; }
```

**Messaging contract:** content script → background → panel carries `AdapterPosition`; panel
requests `captureVisibleTab` for the vision path. Keep it a small typed union mirroring the
existing `Command`/`ServerFrame` discipline.

## 6. Repository organization

Target: an npm/pnpm **workspace**.

- `packages/core` — platform-neutral: `core/`, `vision/`, the `engine/` seam + parsing,
  shared `lib/`, and the reusable Svelte components. **Owns the test suite.**
- `apps/desktop` — the existing Tauri app, thinned to its shell, importing `packages/core`.
- `apps/extension` — the new WXT project.

**Phasing to de-risk:** extract `packages/core` and re-point the *desktop* app at it **first**,
keeping its ~580 tests green — this proves the extraction before any extension code exists.
Only then build `apps/extension`. (Detailed task breakdown belongs in the implementation plan.)

## 7. Permissions & manifest (least-privilege)

- `sidePanel` (Chrome) / `sidebar_action` (Firefox) — the UI surface.
- `activeTab` — grants `captureVisibleTab` on user gesture, so **vision-anywhere needs no
  `<all_urls>`** (privacy-friendly; the user clicks to capture).
- `host_permissions` for **chess.com + lichess only** — lets the adapters run live there.
- `storage` — settings (depth, lines, engine threads, default source).
- `scripting` — register/inject content-script adapters.
- `offscreen` — reserved for the deferred background-analysis upgrade; not in MVP.

## 8. Error handling & graceful degradation

- **Adapter breaks** (site changed its markup): `readPosition()` returns `null` → panel offers
  the **vision fallback** on that tab. The adapter is never the only path.
- **No board found by vision:** surface a clear "no board detected — adjust the tab / try again"
  state; never throw into the UI (mirrors the orchestrator's existing degrade-don't-throw rule).
- **Engine WASM fails to load / SAB unavailable:** fall back to the single-threaded build; if
  that also fails, show an engine-unavailable state while board reconstruction still works.
- **`captureVisibleTab` denied** (no gesture / restricted page like the store or `chrome://`):
  explain the limitation; DOM path unaffected on adapter sites.

## 9. Testing strategy

- **Reused suite** runs unchanged from `packages/core` (chess/classify/accuracy/serialize +
  vision units). This is the executable spec — keep it green through the extraction.
- **New unit tests:** each `SiteAdapter.readPosition()` against captured DOM fixtures
  (chess.com + lichess HTML snapshots); the `RgbaImage` decode from a known data URL; the
  `wasmEngine` `UciEngine` conformance (handshake → `bestmove` round-trip) with a stub/real WASM.
- **Manual browser gate** (human): load unpacked in Chrome and Firefox; verify DOM live-update
  on chess.com/lichess and on-demand vision on an arbitrary page; confirm the WASM engine
  streams eval in the panel. (Analogous to the desktop "manual desktop gate.")

## 10. Risks & open questions

- **DOM adapters are per-site and fragile** — chess.com is obfuscated; markup can change. Start
  with two sites; the vision fallback is the safety net. Adapters need version-tolerant parsing.
- **`captureVisibleTab` constraints** — ~1 fps, whole viewport only, needs a user gesture, and is
  blocked on privileged pages. Fine for on-demand vision; not for continuous.
- **WASM engine strength vs. size** — bundle a single-threaded SF for the baseline; ship the
  multithreaded build too and select at runtime. Net/binary size affects the packaged extension.
- **Firefox SAB / side-panel parity** — validated in the plan phase; single-threaded baseline
  means Firefox is never blocked on it.
- **Liveness cost** — DOM `MutationObserver` must debounce to one analyze per settled position.

## 11. Rough milestones (build order; details in the plan)

1. **Extract `packages/core`**, re-point the desktop app, keep tests green. *(de-risk)*
2. **WXT skeleton** — `apps/extension`, side panel opening on the toolbar icon, both browsers.
3. **WASM engine** — `wasmEngine.ts` implementing `UciEngine`; panel streams eval on a hardcoded FEN.
4. **Vision path** — `TabCapturer` → vision worker → FEN; on-demand capture button.
5. **DOM adapters** — chess.com + lichess; live update via `observe`.
6. **Polish** — panel UI (board + eval bar + best line + arrow), settings, error states.
7. **Manual cross-browser gate.**
```
