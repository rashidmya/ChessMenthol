# Curated Engine Downloads — Design (Phase 3b)

> Phase 3b of engine management. Builds on bring-your-own engines
> ([2026-06-30-engine-management-byo-design.md](2026-06-30-engine-management-byo-design.md))
> and the per-engine options panel
> ([2026-06-30-engine-options-panel-design.md](2026-06-30-engine-options-panel-design.md)).
> This is the "download manager + per-OS binary catalog + checksums" the BYO spec
> explicitly deferred to Phase 3.

## 1. Goal

Let the user install reputable UCI engines they don't already have with one click,
from a **curated, checksummed catalog baked into the app**. Downloaded engines flow
through the existing engine machinery (registry → controller → per-engine options),
so once installed they behave exactly like a bring-your-own engine.

The bundled Stockfish 18 (universal `sse41-popcnt` build) stays the default and is
untouched. Bring-your-own (point at any binary) stays available. This adds a third,
convenience path: pick from a list, click Install.

## 2. Locked decisions (from brainstorming)

1. **Catalog scope = alternative engines + a CPU-optimized Stockfish build.** The bundled
   SF is the conservative compatibility build; the catalog offers (a) a faster SF build
   matched to the host CPU and (b) a small set of strong non-Stockfish engines for variety.
2. **All three platforms** (Linux x64, Windows x64, macOS x64 + arm64). The manifest is
   per-OS/arch from the start; an OS with no entry for a given engine simply shows
   "not available for your platform."
3. **Catalog is baked into the app** — a static, typed manifest with **checksums pinned at
   build time**. No live catalog fetch (most secure, works offline, simplest). Structured so
   a remote-override source could be added later without redesign.
4. **Rust-native download/install** — a Tauri command does the network + verify + extract +
   install; the frontend only invokes it and renders progress. Keeps network off the
   COEP-`require-corp` webview, matches the existing "Rust does the I/O" pattern
   (`engine_probe`, capture), and adds **zero** new frontend capabilities.
5. **New engine kind `downloaded`** — app-owned binaries in app storage; removing one deletes
   its files. Distinct from `external` (BYO reference paths, never deleted).

## 3. Selection criterion for the catalog

Only engines that are a **self-contained single binary** — embedded NNUE, no separate
weights file, no GPU/CPU backend setup — with **official per-OS release assets**. This
deliberately excludes Leela/Lc0 (needs separate network weights + a backend; not one-click).
Lc0-style engines could become a future special case; out of scope here.

### Curated starter set (v1, intentionally small)

| id | Engine | Why | License |
|---|---|---|---|
| `stockfish-optimized` | Stockfish (CPU-optimized) | The "fast SF for your CPU" — BMI2 → AVX2 → SSE41 variants picked per host | GPL-3 |
| `berserk` | Berserk | Top-tier NNUE, single binary, clean per-OS GitHub releases | GPL-3 |
| `viridithas` | Viridithas | Strong, Rust, embedded net, tidy releases (already validated locally) | GPL-3 |

Held for later (all viable, kept out to keep v1 tight): Caissa, Koivisto, RubiChess.

## 4. Data model

### 4.1 Registry (`engineRegistry.ts`) — add the `downloaded` kind

```ts
export type EngineKind = 'bundled' | 'external' | 'downloaded';
// EngineRecord unchanged in shape: { id, name, kind, path? }
//   external   — BYO; path references a user location; remove NEVER deletes the file.
//   downloaded — app-managed; path is inside appData/engines/<id>/; remove DELETES the dir.
```
- `loadExternal()` (rename intent: "load persisted") accepts both `external` and `downloaded`
  records (both require a `path`); the bundled id remains reserved/non-removable.
- A `downloaded` record's **`id` is the catalog id** (`stockfish-optimized`, `berserk`, …),
  not a uuid — so there is exactly one install per catalog engine, and install/uninstall/
  "is it installed?" all map cleanly by id.
- The engine controller is unchanged: it already runs "any record with a `path`" as a native
  process, so `downloaded` spawns identically to `external`.

### 4.2 Catalog manifest (`engineCatalog.ts`) — new, the single source of truth

```ts
export type HostTarget = 'linux-x64' | 'windows-x64' | 'macos-x64' | 'macos-arm64';
export type CpuFeature = 'bmi2' | 'avx2' | 'sse41'; // extend as needed
export type ArchiveKind = 'raw' | 'zip' | 'tar' | 'tar.gz';

export interface BuildVariant {
  variantLabel: string;          // "BMI2" | "AVX2" | "SSE41" | "" (display)
  requiresCpuFeature?: CpuFeature; // omit = universal; ordered best→fallback in the array
  url: string;                   // upstream release asset (HTTPS)
  sha256: string;                // PINNED — computed once during authoring
  sizeBytes: number;             // for the progress bar + a sanity check
  archive: ArchiveKind;
  binaryInArchive?: string;      // path of the executable inside the archive (omit for 'raw')
}

export interface CatalogEngine {
  id: string;                    // stable; becomes the registry id when installed
  name: string;                  // display name (the probe later overwrites with real id name)
  blurb: string;
  license: string;
  homepage: string;
  builds: Partial<Record<HostTarget, BuildVariant[]>>; // ordered best→fallback per target
}

export const ENGINE_CATALOG: CatalogEngine[];
```
Variant selection: for the host target, pick the **first** `BuildVariant` whose
`requiresCpuFeature` the CPU supports (or that has none). Most engines have a single
universal variant; Stockfish carries several.

## 5. Rust commands (`engine.rs` / a new `download.rs` module)

All registered in `lib.rs::generate_handler!`. Network egress is from the Rust process
(not the webview), so no frontend capability changes.

### 5.1 `host_target() -> HostTargetInfo`
Returns `{ os, arch, cpu_features: Vec<String> }` from `std::env::consts` +
`std::arch::is_x86_feature_detected!` (and arch detection for macOS arm64). The frontend
uses it to resolve a `CatalogEngine` to one `BuildVariant`.

### 5.2 `engine_download(args, on_progress: Channel<DownloadProgress>) -> EngineInstall`
`args = { id, url, sha256, size_bytes, archive, binary_in_archive }`. Steps, each emitting
a `DownloadProgress { phase, received, total }` on the Channel
(`phase ∈ downloading | verifying | extracting | done`):
1. Stream the URL to a temp file (follows redirects — release assets 302 to object storage),
   emitting byte progress.
2. **Verify sha256.** Mismatch → delete temp, `Err("verification failed …")`. A binary that
   fails verification is **never** installed.
3. Extract per `archive` (`raw` = move as-is; `zip`; `tar`; `tar.gz`) into
   `app_data_dir()/engines/<id>/` (cleared first if it already exists). Locate the binary via
   `binary_in_archive`; `Err` if absent.
4. `chmod +x` on unix.
5. Return `EngineInstall { path }` (absolute path to the installed binary).

The Channel pattern mirrors `engine_start`'s `onLine` channel. Cleanup (temp + partial dir)
runs on every error path.

### 5.3 `engine_uninstall(id) -> Result<(), String>`
Recursively deletes `app_data_dir()/engines/<id>/`. Idempotent (missing dir = ok).

### 5.4 Dependencies added to `Cargo.toml`
- `ureq` (with rustls) — sync HTTP with redirect handling and a streaming reader for
  progress; no OpenSSL system dependency; light. (Sync fits the existing
  `std::process`-based engine code; runs on a worker thread so the command can report
  progress.)
- `zip` — Windows/zip assets.
- `tar` + `flate2` — `.tar` / `.tar.gz` assets (Stockfish Linux/macOS).
- `sha2` — checksum verification.

(If a chosen engine ships only `.tar.zst`/`.tar.xz`, add `zstd`/`xz2` during manifest
authoring; the starter set is expected to be zip/tar/tar.gz/raw.)

## 6. Install / uninstall flow (frontend)

Install (driven from the catalog UI):
1. `host_target()` → resolve the `CatalogEngine` to one `BuildVariant` (or "unavailable").
2. `engine_download(variant, id, onProgress)` → render the progress bar from the Channel.
3. On success: `engine_probe({ kind: 'external', path })` to capture the engine's real
   `id name` + option lines (reuses the Phase-3a probe). Note: here `kind: 'external'` is the
   Rust **`EngineSpec`** discriminator meaning "spawn this path" — it is NOT the registry
   `EngineKind`; the record created in step 4 is `kind: 'downloaded'`. (EngineSpec has only
   `External { path }` | `Bundled`; downloaded engines are probed/spawned by path.)
4. `registry.add({ id, name, kind: 'downloaded', path })` + `engineOptions.setSchema(id, …)`
   (reuses Phase-3a schema caching) + select the engine.

Uninstall (a `downloaded` record's trash control):
`registry.remove(id)` + `engineOptions.clear(id)` + `invoke('engine_uninstall', { id })`;
if it was the selected engine, fall back to `'stockfish'` (existing behavior).

Install location: `app_data_dir()/engines/<id>/` (per-OS standard:
`~/.local/share/app.chessmenthol/…`, `%APPDATA%\…`, `~/Library/Application Support/…`).
Resolved Rust-side via the Tauri path API (core, no plugin); files written with `std::fs`.

## 7. UI

A **"Download engine"** affordance next to the existing "+ Add engine", opening a catalog
panel. Each `CatalogEngine` row shows name, blurb, license, and one of:
- **Install** button → progress bar → on success the engine appears in the picker, selected;
- **Installed** state (its per-engine options are then available via Phase 3a);
- **"Not available for your platform"** when `builds` has no entry for the host target.
Errors render inline with a retry. Styling follows the existing `EngineList`.

**Placement note (parallel work):** a separate "home/analysis/edit screen restructure" is in
flight and may relocate the engine picker. This spec treats the catalog UI's *location* as
"wherever the engine picker lands" — the components, flow, and Rust surface here are
independent of that placement. Implementation sequencing must account for the restructure
(coordinate before wiring the panel into a screen).

## 8. Error handling

Every failure is a surfaced, non-fatal message; partial artifacts are cleaned up:
- Network failure / non-200 / timeout → "download failed" (temp removed).
- **Checksum mismatch** → "verification failed — file may be corrupt or tampered; not
  installed" (temp removed). Security-critical: an unverified binary is never run.
- Extraction failure / binary not found in archive → "install failed" (partial dir removed).
- Post-install `engine_probe` failure (binary present but not a working UCI engine) → surface
  + offer uninstall.
- macOS quarantine: files written by our own process generally do **not** receive the
  `com.apple.quarantine` xattr (that is applied by browsers/Finder), so the BYO-spec
  quarantine concern is largely moot for downloads; if a spawn still fails with that error we
  surface it (no auto-strip in v1).
- Disk-full / permission on the app-data dir → surfaced.

## 9. Testing

**Rust unit tests** (no live network):
- sha256 verify — match and mismatch.
- Extraction — `zip` and `tar`/`tar.gz` fixtures → correct binary located + executable.
- Variant selection by CPU feature (given a feature set, pick the right variant).
- `host_target()` shape.
- `engine_uninstall` removes the dir; idempotent on a missing dir.

The live HTTP download path is exercised only in the manual e2e (unit tests use local
fixture files).

**Frontend tests** (vitest, mocked `invoke` + `Channel`):
- catalog → install → registry gains a `downloaded` record + schema cached + engine selected.
- progress states render from the Channel.
- checksum/network failure → error surfaced, registry **unchanged**.
- uninstall → record removed + options cleared + `engine_uninstall` invoked.
- "Installed" vs "Install" state per catalog id; "not available for your platform" when no
  variant for the host target.

**Manual e2e (human gate):** real download + install of each catalog engine on Linux; confirm
it analyzes and its options panel renders; uninstall deletes the files. Windows/macOS download
paths are validated by checksum + extraction logic and best-effort, and explicitly flagged as
not fully testable without those machines.

## 10. Out of scope (YAGNI)

Leela/Lc0 and any weights-file or GPU-backend engines; engine **version/update** management
(re-download replaces in place); a **remote/fetched** catalog (structured for it, not built);
**parallel** multi-installs (one at a time); **resumable/partial** downloads; **mirroring**
binaries (we link upstream releases); auto-updating the bundled Stockfish.

## 11. Assumptions & risks

- **Manifest authoring cost.** Each engine × OS × arch (× ISA for Stockfish) needs a real URL
  and a **real pinned sha256** (computed by downloading each asset once during implementation,
  since most upstreams don't publish checksums). ~15–25 entries for the starter set. This is
  the recurring maintenance tail: new engine versions → new checksums → app release.
- **Cross-platform testability.** Only the Linux download path is truly testable on the dev
  machine; Win/Mac entries are authored from upstream + verified by checksum/extraction logic.
- **Parallel restructure.** The catalog UI's host screen may move (see §7); the design is
  placement-independent, but wiring must be sequenced against that work.
- **Upstream URL drift.** Pinned asset URLs can 404 if an upstream reorganizes releases;
  surfaced as a normal download failure, fixed by a manifest update.
