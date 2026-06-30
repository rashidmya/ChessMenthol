# Engine Management — Bring-Your-Own UCI Engine — Design

**Date:** 2026-06-30
**Branch:** feat/svelte-tauri-migration
**Status:** Draft for review

## 1. Problem & context

Phase 1 shipped a native Stockfish 18 sidecar that drives analysis on the desktop. The
original multi-engine plan (`docs/superpowers/specs/2026-06-29-multi-engine-selection-design.md`)
wanted to offer Lichess's three options ("dev · 85 MB", "· 108 MB", "· 15 MB") by **swapping
`EvalFile` NNUE nets on the one bundled binary**.

**That premise was disproven** (verified 2026-06-29; see the `stockfish-net-swap-invalid` note):
the three Lichess options are different *builds* (`sf_dev`, `sf_18`, `sf_18_smallnet`) with
**different net architectures** — the Lichess "small" net (`nn-4ca89e4b3abf`) is rejected by our
stable SF18 binary (`ERROR: Network evaluation parameters compatible with the engine must be
available`). There is no meaningfully-different SF18-compatible net to swap in, so "selectable
nets" cannot deliver engine variety.

This spec **supersedes the net-swap approach**. Instead, we let users run **any UCI engine** —
the model every desktop chess GUI (Arena, Cute Chess, En Croissant) uses. The bundled Stockfish 18
stays the default; users can **add their own engine binaries** ("bring your own"). A curated
one-click download list is explicitly deferred to a later phase.

## 2. Scope decision (agreed)

- **Bring-your-own (BYO) first.** The user points the app at a UCI engine binary already on disk;
  we validate it and run it. *Curated downloads are out of scope for this phase* (Phase 3).
- **Minimal.** Added engines run through the app's **existing** analysis and controls (Threads/Hash).
  **No per-engine UCI options panel** (no parsing each engine's `option name` lines into a form).
- **Reference binaries in place** (store the path; do not copy the binary into app storage).
- **Architecture ①:** the engine registry lives in the **frontend** (localStorage); Rust stays the
  thin spawn-bridge Phase 1 already built, generalized from "the one sidecar" to "sidecar **or**
  external path".

## 3. Architecture & components

We widen the engine seam from "the one bundled engine" to "any UCI engine," with the bundled
Stockfish as one always-present entry. The orchestrator / `AnalysisSession` / classify code are
**unchanged** — the `UciEngine` seam already abstracts the engine.

### 3.1 Frontend
- **`engineRegistry.ts` (new):** owns the engine list, persisted to `localStorage` (key
  `chessmenthol.engines`), like the existing `viewprefs`. Record shape:
  ```ts
  type EngineRecord = {
    id: string;                    // 'stockfish' (bundled) | uuid (external)
    name: string;                  // 'Stockfish 18' | the engine's reported `id name`
    kind: 'bundled' | 'external';
    path?: string;                 // external only: absolute path to the binary
  };
  ```
  The bundled record is injected on load and cannot be removed. Only external records are persisted;
  the bundled entry is synthesized at runtime. Exposes `list()`, `add(record)`, `remove(id)`,
  `get(id)`.
- **`engineController` generalization:** `select(id)` looks the id up in the registry; `load()`
  builds an engine for that record. The Phase-1 `engineId()` constant and the fixed `presetFor`
  if-chain are generalized to a registry lookup that drives engine **identity**: under Tauri the
  record selects the bundled sidecar or an external binary path; in a plain browser the bundled entry
  keeps loading via the existing `loadStockfish` path (unchanged — external engines don't exist
  there, see §3.4). **Threads/Hash** continue to come from the app's existing global controls
  (`configure()`), applied to whichever engine is selected, rather than being bundled into a per-id
  preset.
- **`nativeEngine.ts` generalization:** `loadNativeEngine` takes the record (kind + path) and passes
  it to `engine_start`.

### 3.2 Rust (thin bridge — Phase-1 lifecycle reused verbatim)
- **`engine_start` generalized:** takes an engine spec instead of the ignored `engine_id`:
  `{ kind:'bundled' }` → `app.shell().sidecar("stockfish")` (with the existing CWD-net logic), or
  `{ kind:'external', path }` → spawn that path. stdin-write, stdout→`Channel`, kill-on-restart, and
  kill-on-exit (`RunEvent::Exit`) are all unchanged. (Spawning a user-chosen path is Rust-side, so it
  is not gated by the JS shell ACL — acceptable: the user explicitly picked the binary, exactly like
  any desktop chess GUI.)
- **`engine_validate(path) -> Result<{ name: String }, String>` (new command):** spawns the binary,
  sends `uci`, reads stdout until `uciok` (timeout ~10 s), captures the `id name …` line, kills the
  process, and returns the name — or an error string if it never handshakes / isn't executable.

### 3.3 New dependency
- **Tauri dialog plugin** (`tauri-plugin-dialog` + `@tauri-apps/plugin-dialog`) for the native
  "choose a file" picker.

### 3.4 Platform note
"+ Add engine" and external engines are **Tauri-only** (gated by `isTauri()`). In a plain browser
the EngineList shows only the bundled Stockfish (the existing wasm engine) with **no add button** —
consistent with how native capture / vision are already Tauri-only.

## 4. Data flow

- **Add:** "+ Add engine" → native open-file dialog → `invoke('engine_validate', { path })`.
  On success: create `{ id: uuid, name, kind:'external', path }`, persist to the registry, and select
  it. On failure: surface the reason; nothing is added.
- **Select:** `send({ type:'set_engine', id })` → orchestrator `setEngine(id)` →
  `engineController.select(id)` → registry lookup → `engine_start({ kind, path })`. (Existing
  orchestrator path, unchanged.)
- **Remove:** drop an external record from the registry; if it was the selected engine, fall back to
  the bundled Stockfish. The bundled entry cannot be removed.

## 5. UI — `EngineList`

Replaces the engine `<select>` in `EngineSettings.svelte` (inside the settings/cog popover). A radio
list:
- One row per engine: filled radio `●` = selected (only one); click a row to select. Bundled
  **Stockfish 18** is always first and has no remove control. External rows show the binary path
  (muted) and a `✕` to remove.
- **"+ Add engine"** action at the bottom → OS file picker → *validating* (transient spinner row)
  → on success the engine appears, selected.
- **Add-failed:** an inline error line ("… isn't a working UCI engine"); nothing is added.
- **Missing binary (minimal):** *no proactive greyed state.* If a selected engine's binary has
  moved/been deleted, spawning fails on use → an error is surfaced and the app falls back to bundled
  Stockfish; the entry stays in the list so the user can remove it.

## 6. Error handling

- **Validation failure** (no `uciok` within ~10 s, not executable, not a real binary): clear message;
  nothing added.
- **Select/spawn failure** (binary moved/deleted, not executable, crashes on launch): surface an error
  frame and **fall back to bundled Stockfish 18** so analysis keeps working; the failed entry remains
  for removal.
- **Removing the selected engine** → switch to Stockfish 18.
- **Cross-platform:** external engines are the user's own binaries. Unix needs the exec bit (the
  user's binary already has it; otherwise spawn fails → error); Windows uses `.exe`; on macOS a
  *downloaded* binary may be Gatekeeper-quarantined (spawn fails with an OS error we surface — MVP
  does not auto-unquarantine). The primary platform (Linux) is unaffected.

## 7. Testing

- **Frontend (vitest, existing mock patterns):**
  - `engineRegistry`: add / remove / persist / hydrate; bundled always present & non-removable.
  - `engineController` selection: bundled → sidecar spawn ref; external → path passed to `engine_start`.
  - Add flow: validate-success adds + selects; validate-failure surfaces an error and adds nothing.
  - Mock `invoke` + the dialog plugin (the `nativeEngine.test.ts` / `engineClientNative.test.ts`
    `vi.hoisted` patterns).
- **Rust (first unit tests in the crate):** `engine_validate` happy path — spawn the bundled
  Stockfish, assert `uciok` + captured name; failure path — a non-engine binary (e.g. `/bin/cat`) →
  timeout/error.
- **Manual e2e:** add a real second engine binary, select it, confirm analysis streams; remove it;
  confirm fallback to bundled.

## 8. Phasing

This BYO feature is the new "Phase 2." The implementation plan will be ordered tasks, mirroring
Phase 1's style:
1. **Rust:** generalize `engine_start` (bundled | external path) + new `engine_validate` + add the
   dialog plugin/capability.
2. **Frontend core:** `engineRegistry` + generalize `nativeEngine` / `engineController`.
3. **UI:** `EngineList` + add/remove/select wiring (replace the `<select>`).
4. **Tests + manual e2e.**

Curated one-click engine downloads (the download manager + per-OS binary catalog + checksums) become
**Phase 3**.

## 9. Out of scope (YAGNI)

Per-engine UCI options panel; curated/one-click engine downloads; copying binaries into app storage;
macOS auto-unquarantine of downloaded binaries; multiple simultaneous engines; net/`EvalFile`
swapping (proven unworkable); proactive "missing binary" scanning.
