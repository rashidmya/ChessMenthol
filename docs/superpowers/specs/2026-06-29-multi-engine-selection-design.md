# Multi-Engine Selection (Lichess-parity) — Design

**Date:** 2026-06-29
**Branch:** feat/svelte-tauri-migration
**Status:** Draft for review

## 1. Problem & context

The app currently runs Stockfish inside the webview as wasm (with an asm.js fallback
on WebKitGTK). We want to offer the user a choice of engines, matching the options
Lichess presents in analysis:

- **Stockfish 18 dev · 85 MB**
- **Stockfish 18 · 108 MB**
- **Stockfish 18 · 15 MB**

These three are [`@lichess-org/stockfish-web`](https://github.com/lichess-org/stockfish-web)
builds: **threaded, SIMD WebAssembly**, with the NNUE network **downloaded separately**
(the "85/108/15 MB" labels are the *net* sizes, not the engine). Their nets are the
official Stockfish nets:

| Menu label | Lichess build | NNUE net |
| --- | --- | --- |
| Stockfish 18 dev · 85 MB | `sf_dev` | `nn-71d6d32cb962.nnue` |
| Stockfish 18 · 108 MB | `sf_18` (big) | `nn-c288c895ea92.nnue` |
| Stockfish 18 · 15 MB | `sf_18_smallnet` | `nn-4ca89e4b3abf.nnue` |

**Hard blocker:** these builds require `SharedArrayBuffer` + cross-origin isolation +
wasm threads + SIMD. The Linux Tauri webview (WebKitGTK 2.52) does **not** expose
`SharedArrayBuffer` and **SIGSEGVs** instantiating Stockfish's SIMD wasm — both verified
e2e against `libwebkit2gtk-4.1` (see `webkitgtk-stockfish-wasm-crash` memory and the
asm.js fallback already shipped). So these engines **cannot run in the Linux webview**.
They run fine on lichess.org (Chrome/Firefox) and in Windows' WebView2.

Since the nets are the official Stockfish nets, the way to deliver exactly these options
on the desktop — and faster — is to run **native Stockfish** from the existing Rust shell.

## 2. Approaches considered

1. **Native engine on desktop (chosen).** Run native Stockfish as a Tauri sidecar
   subprocess, UCI over IPC. Full strength + native speed on all OSes; sidesteps the
   WebKitGTK wasm crash. Cost: per-OS/arch binaries, macOS notarization, CPU-microarch care.
2. **In-webview wasm only.** Add the Lichess wasm engines in the webview. Rejected: they
   can't run on the user's primary platform (Linux/WebKitGTK) at all.
3. **Hybrid (native Linux, wasm Win/mac).** Two engine backends by platform. Rejected for
   v1: inconsistent behavior/perf and double the surface to maintain. Native everywhere is
   simpler and uniformly faster.

## 3. Chosen design

### 3.1 Backend
- **Desktop (Tauri):** native Stockfish, spawned by Rust as a sidecar; UCI piped over
  stdin/stdout and bridged to the frontend. A new `NativeEngine` implements the existing
  `UciEngine` seam (`send` / `onLine` / `dispose`). **Orchestrator / AnalysisSession /
  classify code are unchanged.**
- **Pure-web (browser build):** unchanged — keeps the wasm/asm.js `WorkerEngine`.
  `engineController` selects `NativeEngine` when `isTauri()`, else `WorkerEngine`.

### 3.2 Delivery
- **Bundle** one stable native Stockfish 18 binary **+ the small net** (`nn-4ca89e4b3abf`,
  loaded via `EvalFile`) → the offline default, shown as **"Stockfish 18 · 15 MB"** and pre-selected.
- **Download on demand:** the **big net** (→ "Stockfish 18 · 108 MB") and the **dev engine
  package** (dev binary + dev net → "Stockfish 18 dev · 85 MB"). Cached in the app-data dir;
  persisted across launches; integrity-checked (the net filename is its content hash).
- Net swapping uses Stockfish's `EvalFile` UCI option; threads/hash come from the existing
  sliders (native can now actually use multiple threads).

### 3.3 Components
1. **Rust — engine sidecar manager:** spawn/kill the binary, wire stdin/stdout, lifecycle
   on engine switch. Windows: no-console-window flag. Linux: ensure exec bit.
2. **Rust — download manager:** stream a file to the cache dir, emit progress events,
   verify SHA-256, support cancel + retry. Handles both nets and the dev binary.
3. **Frontend — `NativeEngine`:** `UciEngine` over Tauri IPC (invoke to send a line;
   channel/event for output lines). Lives beside `WorkerEngine`.
4. **Engine catalog (declarative):** one source of truth — `{ id, label, sizeLabel, kind:
   bundled|download, binaryRef, net: { url, sha256, sizeBytes } }` — drives both loading and UI.
5. **UI — `EngineList` component:** replaces the `<select>` in `EngineSettings.svelte`.
   Custom radio list with per-row states (below). Wired through the existing `set_engine`
   command + new download commands.

### 3.4 UI states (per row)
- **Not downloaded:** greyed, not selectable, `[ Download ]` button.
- **Downloading:** inline progress bar under the row (`58%  ·  63 / 108 MB`) + cancel `✕`.
- **Downloaded:** a normal selectable row (no badge/checkmark).
- **Failed:** `[ Retry ]` + a short reason line.
- **Selected:** filled radio `●` (the only selected-state indicator).
- Order top→bottom matches Lichess: dev · 85 MB, 18 · 108 MB, 18 · 15 MB.

### 3.5 Data flow
- **Select engine:** if the package is present → Rust (re)spawns the binary with
  `EvalFile=<cached net path>`; analysis proceeds exactly as today. If absent → row is
  disabled (can't be selected until downloaded).
- **Download:** UI → Rust download command → progress events → progress bar → on success,
  verify hash, mark available; on failure, Retry.

### 3.6 Storage locations (downloaded engines/nets)

Downloaded files live under an `engines/` folder in the OS **local** data dir. The parent
folder name is a **single constant we control** (`APP_DIR`, default `ChessMenthol`),
**decoupled from the Tauri bundle identifier**, so it can be renamed later without touching app
identity:

| OS | Path |
| --- | --- |
| Linux | `~/.local/share/ChessMenthol/engines/` (honors `$XDG_DATA_HOME`) |
| macOS | `~/Library/Application Support/ChessMenthol/engines/` |
| Windows | `%LOCALAPPDATA%\ChessMenthol\engines\` → `C:\Users\<user>\AppData\Local\ChessMenthol\engines\` |

Rust resolves the base via `app.path().local_data_dir()` (non-roaming) and appends `APP_DIR` +
`engines/`. **Local, not roaming** (large files mustn't sync across machines); **data dir, not
cache dir** (the OS can purge caches — re-downloading 108 MB would hurt).

```
<local_data>/ChessMenthol/engines/
  registry.json            ← installed packages: id, version, files, sha256, sizes
  nets/
    nn-c288c895ea92.nnue   ← big net (108 MB), downloaded
    nn-71d6d32cb962.nnue   ← dev net (85 MB), downloaded
  bin/
    stockfish-dev[.exe]    ← dev binary, downloaded (chmod +x on unix)
```

- **Bundled** engine binary + small net live **inside the app install** (read-only Tauri
  resource / sidecar, resolved via `resolveResource()` / the sidecar path) — *not* here.
- **Downloaded** nets + dev binary live in `engines/` (writable, survive app updates).

**Renaming the folder later:** change the `APP_DIR` constant. If renamed after release, a
startup migration moves a known legacy folder (a prior `APP_DIR` value) to the new one so
downloads aren't lost. Pre-release, just change the constant — no migration.
This governs only the engines folder; the webview's `viewprefs` localStorage is keyed off the
bundle identifier and is unaffected.

## 4. Per-OS packaging
- Tauri **`externalBin`** sidecars, one per target triple (win-x64 [+arm64], mac arm64+x64
  /universal, linux-x64 [+arm64]).
- **CPU microarch:** ship a **safe baseline** build (e.g. `x86-64-sse41-popcnt`) — zero
  "illegal instruction" risk. Runtime AVX2/BMI2 detection is a later optimization (out of scope).
- **macOS:** the sidecar must be **signed + notarized with the app** (Gatekeeper).
- **Hosting:** mirror nets + the dev binary in our **GitHub Release assets** (versioned,
  reliable) rather than hitting the Stockfish fishtest server directly.

## 5. Error handling
- Download failure / checksum mismatch → discard partial, show Retry + reason; never select a
  half-present engine.
- Engine spawn failure → fall back to the bundled engine and surface an error frame.
- Offline → only bundled engine selectable; download buttons show a clear "offline" state on attempt.

## 6. Testing
- **Unit:** engine catalog; download-manager state machine (mock fetch: progress, cancel,
  failure, checksum mismatch); `NativeEngine` UCI line framing; engine-selection logic;
  `EngineList` component states.
- **Integration (Rust):** spawn native Stockfish, UCI round-trip (`uci`→`uciok`,
  `go`→`bestmove`); download+verify happy/fail paths.
- **e2e:** reuse the PyGObject WebKit harness to confirm the desktop app uses the native
  engine (no wasm crash) and streams analysis.

## 7. Phasing
- **P1 — native bridge:** `NativeEngine` + Rust sidecar + bundled SF 18 (small net). Desktop
  analysis runs natively (replaces the crashing wasm on Linux). Menu shows the one bundled engine.
- **P2 — downloads + big net:** download manager, "Stockfish 18 · 108 MB" option, the full
  `EngineList` UI with progress/cancel/retry.
- **P3 — dev engine + polish:** dev engine package (binary + net), cache management, AVX2
  detection if desired.

## 8. Pragmatic fidelity note
Lichess's "15 MB" is a special *threat-small* (`sscg13`) build; ours is stable **SF 18 running
on the small net** — same label, near-identical strength, far less build/CI overhead. We can
swap in the exact build later for bit-exact parity if wanted.

## 9. Out of scope (YAGNI)
Runtime AVX2/BMI2 binary selection; resume-partial-downloads; multiple simultaneous engines;
non-Stockfish engines / Fairy variants; in-webview wasm for the three Lichess engines.
