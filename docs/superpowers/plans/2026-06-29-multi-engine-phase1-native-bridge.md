# Multi-Engine Phase 1 — Native Engine Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop (Tauri) app run a **native Stockfish** process for analysis instead of the in-webview wasm/asm.js engine, so analysis works on Linux/WebKitGTK (where wasm crashes) and is faster everywhere.

**Architecture:** A native Stockfish binary is bundled as a Tauri **sidecar**. A small Rust module spawns it, writes UCI to its stdin, and streams stdout lines to the frontend over a Tauri **`ipc::Channel`**. On the frontend, a new `NativeEngine` implements the existing `UciEngine` seam (`send`/`onLine`/`dispose`); `engineController` builds a `NativeEngine` under Tauri and the existing `WorkerEngine` (wasm) in a plain browser. The orchestrator, `AnalysisSession`, and classify code are untouched.

**Tech Stack:** Tauri 2, `tauri-plugin-shell` (sidecar spawn + `CommandChild`/`CommandEvent`), `@tauri-apps/api/core` (`invoke`, `Channel`), Svelte/TS frontend, Vitest, official Stockfish binary.

**Scope note:** This is Phase 1 of the multi-engine spec (`docs/superpowers/specs/2026-06-29-multi-engine-selection-design.md`). It delivers ONE bundled native engine that replaces the crashing wasm. The `EngineList` UI, on-demand net/engine downloads, and the dev engine are **Phase 2 / Phase 3** (separate plans). Net *switching* via `EvalFile` is out of scope here — Phase 1 spawns Stockfish with the bundled net auto-loaded from the working directory.

---

## File structure

- `frontend/src-tauri/binaries/` — **create.** Holds the sidecar binary, named per target triple (`stockfish-<triple>`).
- `frontend/src-tauri/resources/engine/` — **create.** Holds the default `.nnue` net (bundled resource, auto-loaded from CWD).
- `frontend/src-tauri/Cargo.toml` — **modify.** Add `tauri-plugin-shell`.
- `frontend/src-tauri/src/engine.rs` — **create.** Engine process manager: `EngineState`, `engine_start`/`engine_send`/`engine_stop` commands.
- `frontend/src-tauri/src/lib.rs` — **modify.** Register the shell plugin, `EngineState`, and the three commands.
- `frontend/src-tauri/capabilities/default.json` — **modify.** Allow spawning the `stockfish` sidecar.
- `frontend/src-tauri/tauri.conf.json` — **modify.** `bundle.externalBin` + `bundle.resources`.
- `frontend/src/engine/nativeEngine.ts` — **create.** `loadNativeEngine()` → `UciEngine` over Tauri IPC.
- `frontend/src/lib/engineClient.ts` — **modify.** `engineController.load()` builds `NativeEngine` under Tauri, else `WorkerEngine`.
- `frontend/src/tests/nativeEngine.test.ts` — **create.** Unit tests (mock `invoke`/`Channel`).
- `frontend/src/tests/engineClientNative.test.ts` — **create.** Unit test for the Tauri-vs-browser branch.

---

## Task 0: Obtain the native Stockfish binary + net (dev = Linux x64)

**Files:**
- Create: `frontend/src-tauri/binaries/stockfish-x86_64-unknown-linux-gnu`
- Create: `frontend/src-tauri/resources/engine/<default-net>.nnue`

- [ ] **Step 1: Find this machine's Rust target triple**

Run: `rustc -vV | sed -n 's/host: //p'`
Expected: `x86_64-unknown-linux-gnu` (used in the sidecar filename below).

- [ ] **Step 2: Download an official Stockfish binary (safe baseline) + its net**

```bash
cd /tmp/claude-1000/-home-buga-Dev-ChessMenthol/05929af5-b67e-4851-9174-8c56c943c0bc/scratchpad
# Safe baseline build (runs on any x86-64-v2 CPU; no AVX2 illegal-instruction risk).
curl -L -o sf.tar https://github.com/official-stockfish/Stockfish/releases/latest/download/stockfish-ubuntu-x86-64-sse41-popcnt.tar
tar xf sf.tar
# The extracted ./stockfish/ dir contains the binary and (for recent releases) the .nnue net(s).
ls -la stockfish/
```
Expected: a `stockfish/stockfish-ubuntu-x86-64-sse41-popcnt` binary, and one or more `nn-*.nnue` files. If no `.nnue` is present, discover the default net name and download it:
```bash
echo -e "uci\nquit" | ./stockfish/stockfish-ubuntu-x86-64-sse41-popcnt | grep -i "EvalFile"
# e.g. "option name EvalFile type string default nn-XXXXXXXX.nnue"
# then: curl -L -o nn-XXXXXXXX.nnue https://tests.stockfishchess.org/api/nn/nn-XXXXXXXX.nnue
```

- [ ] **Step 3: Place the binary (target-triple name) and net into the project**

```bash
P=/home/buga/Dev/ChessMenthol/frontend/src-tauri
mkdir -p "$P/binaries" "$P/resources/engine"
cp stockfish/stockfish-ubuntu-x86-64-sse41-popcnt "$P/binaries/stockfish-x86_64-unknown-linux-gnu"
chmod +x "$P/binaries/stockfish-x86_64-unknown-linux-gnu"
cp stockfish/nn-*.nnue "$P/resources/engine/"
ls -la "$P/binaries" "$P/resources/engine"
```
Expected: `binaries/stockfish-x86_64-unknown-linux-gnu` (executable) and `resources/engine/nn-*.nnue`.

- [ ] **Step 4: Sanity-check the binary speaks UCI**

Run: `printf 'uci\nposition startpos\ngo depth 10\n' | /home/buga/Dev/ChessMenthol/frontend/src-tauri/binaries/stockfish-x86_64-unknown-linux-gnu | tail -3`
Expected: lines including `info depth ...` and a final `bestmove ...` (proves the binary + net work standalone).

- [ ] **Step 5: Ignore large binaries in git (bundled at build time, like the wasm engines)**

Add to `frontend/src-tauri/.gitignore` (create if absent):
```
/binaries/
/resources/engine/
```

- [ ] **Step 6: Commit**

```bash
git -C /home/buga/Dev/ChessMenthol add frontend/src-tauri/.gitignore
git -C /home/buga/Dev/ChessMenthol commit -m "chore(engine): gitignore bundled native Stockfish binary + net (Phase 1)"
```

> **Cross-platform note (later):** Windows/macOS sidecars use the same `binaries/stockfish-<triple>[.exe]` naming (`x86_64-pc-windows-msvc`, `aarch64-apple-darwin`, …); CI fetches the per-OS official builds. Phase 1 wires + verifies the Linux dev path; the Rust/TS code is platform-agnostic.

---

## Task 1: Add the shell plugin, capability, and bundle config

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/capabilities/default.json`
- Modify: `frontend/src-tauri/tauri.conf.json`

- [ ] **Step 1: Add the shell plugin dependency**

In `frontend/src-tauri/Cargo.toml`, under `[dependencies]`, add:
```toml
tauri-plugin-shell = "2"
```

- [ ] **Step 2: Allow spawning the stockfish sidecar**

Replace the `permissions` array in `frontend/src-tauri/capabilities/default.json` with:
```json
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [{ "name": "stockfish", "sidecar": true, "args": true }]
    },
    "shell:allow-spawn"
  ]
```

- [ ] **Step 3: Bundle the sidecar + net**

In `frontend/src-tauri/tauri.conf.json`, inside `"bundle"`, add these two keys (next to `"active": true`):
```json
    "externalBin": ["binaries/stockfish"],
    "resources": ["resources/engine/*"],
```

- [ ] **Step 4: Verify it still builds**

Run: `cd /home/buga/Dev/ChessMenthol/frontend/src-tauri && cargo build 2>&1 | tail -5`
Expected: compiles (downloads `tauri-plugin-shell`). No code uses it yet — that's Task 2.

- [ ] **Step 5: Commit**

```bash
git -C /home/buga/Dev/ChessMenthol add frontend/src-tauri/Cargo.toml frontend/src-tauri/Cargo.lock frontend/src-tauri/capabilities/default.json frontend/src-tauri/tauri.conf.json
git -C /home/buga/Dev/ChessMenthol commit -m "feat(tauri): add shell plugin + sidecar/resource bundle config (Phase 1)"
```

---

## Task 2: Rust engine process manager

**Files:**
- Create: `frontend/src-tauri/src/engine.rs`
- Modify: `frontend/src-tauri/src/lib.rs`

- [ ] **Step 1: Write `engine.rs`**

Create `frontend/src-tauri/src/engine.rs`:
```rust
//! Native Stockfish process bridge. Spawns the bundled `stockfish` sidecar, sets
//! its working directory to the bundled net's folder so Stockfish auto-loads the
//! default net from CWD, writes UCI lines to its stdin, and streams stdout lines
//! to the frontend over an ipc::Channel. One engine at a time (held in EngineState).
use std::sync::Mutex;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the live child so `engine_send` can write to its stdin and `engine_stop`
/// can kill it. `None` when no engine is running.
#[derive(Default)]
pub struct EngineState(pub Mutex<Option<CommandChild>>);

/// Spawn the bundled Stockfish sidecar and stream its stdout lines to `on_line`.
/// `engine_id` is accepted for forward-compatibility (Phase 2 selects nets/binaries);
/// Phase 1 always launches the bundled engine.
#[tauri::command]
pub fn engine_start(
    app: AppHandle,
    state: State<'_, EngineState>,
    engine_id: String,
    on_line: Channel<String>,
) -> Result<(), String> {
    let _ = engine_id; // Phase 1: single bundled engine.

    // Kill any previous engine first.
    if let Some(child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
    }

    // The net is bundled under resources/engine/; run Stockfish with that folder as
    // CWD so it auto-loads its default net without an explicit EvalFile.
    let net_dir = app
        .path()
        .resolve("resources/engine", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve net dir: {e}"))?;

    let (mut rx, child) = app
        .shell()
        .sidecar("stockfish")
        .map_err(|e| format!("sidecar: {e}"))?
        .current_dir(net_dir)
        .spawn()
        .map_err(|e| format!("spawn: {e}"))?;

    *state.0.lock().unwrap() = Some(child);

    // Forward stdout lines (already split on newline by the shell plugin) to the channel.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    let _ = on_line.send(line);
                }
                CommandEvent::Terminated(_) => break,
                _ => {}
            }
        }
    });

    Ok(())
}

/// Write a single UCI line to the running engine's stdin (newline appended).
#[tauri::command]
pub fn engine_send(state: State<'_, EngineState>, line: String) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    let child = guard.as_mut().ok_or("no engine running")?;
    let mut buf = line.into_bytes();
    buf.push(b'\n');
    child.write(&buf).map_err(|e| format!("write: {e}"))
}

/// Kill the running engine, if any. Idempotent.
#[tauri::command]
pub fn engine_stop(state: State<'_, EngineState>) -> Result<(), String> {
    if let Some(child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
    }
    Ok(())
}
```

- [ ] **Step 2: Wire it into `lib.rs`**

In `frontend/src-tauri/src/lib.rs`, add `mod engine;` at the top (below the existing `use` lines), and update the builder in `run()`:
```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(engine::EngineState::default())
        .invoke_handler(tauri::generate_handler![
            capture_frame,
            engine::engine_start,
            engine::engine_send,
            engine::engine_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/buga/Dev/ChessMenthol/frontend/src-tauri && cargo build 2>&1 | tail -8`
Expected: compiles clean. If `child.write` errors on mutability/signature, match the installed `tauri-plugin-shell` `CommandChild::write` signature (it takes `&mut self` here via `as_mut()`).

- [ ] **Step 4: Commit**

```bash
git -C /home/buga/Dev/ChessMenthol add frontend/src-tauri/src/engine.rs frontend/src-tauri/src/lib.rs
git -C /home/buga/Dev/ChessMenthol commit -m "feat(engine): native Stockfish process bridge (start/send/stop) (Phase 1)"
```

---

## Task 3: Frontend `NativeEngine` (UciEngine over IPC)

**Files:**
- Create: `frontend/src/engine/nativeEngine.ts`
- Test: `frontend/src/tests/nativeEngine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/nativeEngine.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core: capture invoke calls; Channel is a plain object whose
// onmessage we can fire to simulate engine stdout.
const invokeMock = vi.fn(async () => {});
class FakeChannel { onmessage: ((m: string) => void) | null = null; }
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
  Channel: FakeChannel,
}));

import { loadNativeEngine } from '../engine/nativeEngine';
import { Channel } from '@tauri-apps/api/core';

beforeEach(() => invokeMock.mockClear());

// Resolve loadNativeEngine by making engine_start fire `uciok` through the channel.
function autoUciok() {
  invokeMock.mockImplementation(async (cmd: string, args: { onLine?: { onmessage?: (m: string) => void } }) => {
    if (cmd === 'engine_start') queueMicrotask(() => args.onLine?.onmessage?.('uciok'));
  });
}

describe('loadNativeEngine', () => {
  it('starts the engine, resolves on uciok, and routes lines to onLine', async () => {
    autoUciok();
    const engine = await loadNativeEngine('sf18');
    expect(invokeMock).toHaveBeenCalledWith('engine_start', expect.objectContaining({ engineId: 'sf18' }));

    const lines: string[] = [];
    engine.onLine((l) => lines.push(l));
    // Grab the channel passed to engine_start and push a batched message.
    const ch = invokeMock.mock.calls.find((c) => c[0] === 'engine_start')![1].onLine as InstanceType<typeof Channel> & { onmessage: (m: string) => void };
    ch.onmessage('info depth 1 score cp 20\nbestmove e2e4');
    expect(lines).toEqual(['info depth 1 score cp 20', 'bestmove e2e4']);
  });

  it('send() forwards a UCI line via engine_send', async () => {
    autoUciok();
    const engine = await loadNativeEngine('sf18');
    invokeMock.mockClear();
    engine.send('go depth 12');
    expect(invokeMock).toHaveBeenCalledWith('engine_send', { line: 'go depth 12' });
  });

  it('dispose() calls engine_stop', async () => {
    autoUciok();
    const engine = await loadNativeEngine('sf18');
    invokeMock.mockClear();
    engine.dispose();
    expect(invokeMock).toHaveBeenCalledWith('engine_stop');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/nativeEngine.test.ts`
Expected: FAIL — `Cannot find module '../engine/nativeEngine'`.

- [ ] **Step 3: Implement `nativeEngine.ts`**

Create `frontend/src/engine/nativeEngine.ts`:
```ts
// frontend/src/engine/nativeEngine.ts
// UciEngine implementation backed by the native Stockfish sidecar (Tauri only).
// Mirrors WorkerEngine's contract: resolves once the engine answers `uciok`, splits
// batched output into trimmed lines, and routes them to the registered listener.
import { invoke, Channel } from '@tauri-apps/api/core';
import type { UciEngine } from './engine';

export async function loadNativeEngine(engineId: string, timeoutMs = 10_000): Promise<UciEngine> {
  let listener: ((line: string) => void) | null = null;

  const channel = new Channel<string>();
  channel.onmessage = (chunk: string) => {
    for (const raw of String(chunk).split('\n')) {
      const line = raw.trim();
      if (line) listener?.(line);
    }
  };

  await invoke('engine_start', { engineId, onLine: channel });

  const engine: UciEngine = {
    send: (cmd: string) => { void invoke('engine_send', { line: cmd }); },
    onLine: (cb: (line: string) => void) => { listener = cb; },
    dispose: () => { void invoke('engine_stop'); },
  };

  // Handshake: send `uci`, resolve on `uciok`, reject if the engine never initializes.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      engine.dispose();
      reject(new Error(`native engine failed to initialize within ${timeoutMs}ms`));
    }, timeoutMs);
    engine.onLine((line: string) => { if (line === 'uciok') { clearTimeout(timer); resolve(); } });
    engine.send('uci');
  });

  return engine;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/nativeEngine.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git -C /home/buga/Dev/ChessMenthol add frontend/src/engine/nativeEngine.ts frontend/src/tests/nativeEngine.test.ts
git -C /home/buga/Dev/ChessMenthol commit -m "feat(engine): NativeEngine UciEngine transport over Tauri IPC (Phase 1)"
```

---

## Task 4: Select NativeEngine under Tauri in engineController

**Files:**
- Modify: `frontend/src/lib/engineClient.ts` (the `load()` closure inside `engineController`, ~lines 86-96)
- Test: `frontend/src/tests/engineClientNative.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/engineClientNative.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture which loader engineController uses. Mock both engine loaders + the Tauri
// detection seam, then drive a start through the lazy session.
const loadNativeEngine = vi.fn(async () => fakeEngine());
const loadStockfish = vi.fn(async () => fakeEngine());
const isTauriMock = vi.fn(() => true);

function fakeEngine() {
  return { send: vi.fn(), onLine: vi.fn(), dispose: vi.fn() };
}

vi.mock('../engine/nativeEngine', () => ({ loadNativeEngine: (...a: unknown[]) => loadNativeEngine(...a) }));
vi.mock('../engine/engine', async (orig) => ({
  ...(await orig<typeof import('../engine/engine')>()),
  loadStockfish: (...a: unknown[]) => loadStockfish(...a),
  threadsAvailable: () => false,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => isTauriMock(), Channel: class {} }));

beforeEach(() => { loadNativeEngine.mockClear(); loadStockfish.mockClear(); });

describe('engineController loader selection', () => {
  it('uses the native engine under Tauri', async () => {
    isTauriMock.mockReturnValue(true);
    const { engineController } = await import('../lib/engineClient');
    await engineController.ensureEngine();
    expect(loadNativeEngine).toHaveBeenCalledTimes(1);
    expect(loadStockfish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/buga/Dev/ChessMenthol && cd frontend && npx vitest run src/tests/engineClientNative.test.ts`
Expected: FAIL — `loadNativeEngine` not called (controller still calls `loadStockfish`).

- [ ] **Step 3: Modify `engineClient.ts`**

In `frontend/src/lib/engineClient.ts`, add to the imports near the top:
```ts
import { loadNativeEngine } from '../engine/nativeEngine';
import { isTauri } from '@tauri-apps/api/core';
```
Then change the `load()` function inside the `engineController` IIFE (currently `return loadStockfish(v).then(...)`) so it picks the native engine under Tauri:
```ts
  function load(v: 'full' | 'lite'): Promise<UciEngine> {
    // Desktop (Tauri): native Stockfish sidecar — wasm crashes WebKitGTK and is slower
    // everywhere. Plain browser: the wasm/asm.js WorkerEngine.
    const loader = isTauri()
      ? loadNativeEngine(engineId(v))
      : loadStockfish(v);
    return loader.then((e) => {
      if (v !== desiredVariant) {
        e.dispose();
        return load(desiredVariant);
      }
      engine = e;
      applyIfLoaded();
      return e;
    });
  }
```
Add this tiny helper just above `load()` (maps the wasm variant to a native engine id; Phase 1 has one engine, so both map to `'stockfish'`):
```ts
  function engineId(v: 'full' | 'lite'): string {
    return v === 'full' ? 'stockfish' : 'stockfish';
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/engineClientNative.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run 2>&1 | tail -4 && npm run check 2>&1 | tail -2`
Expected: all tests pass; `0 ERRORS 0 WARNINGS`.

- [ ] **Step 6: Commit**

```bash
git -C /home/buga/Dev/ChessMenthol add frontend/src/lib/engineClient.ts frontend/src/tests/engineClientNative.test.ts
git -C /home/buga/Dev/ChessMenthol commit -m "feat(engine): use NativeEngine under Tauri, wasm in browser (Phase 1)"
```

---

## Task 5: End-to-end verification on real WebKitGTK

**Files:** none (verification using the existing PyGObject harness from the WebKitGTK debugging session).

- [ ] **Step 1: Launch the desktop app**

Run: `cd /home/buga/Dev/ChessMenthol/frontend && WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`
(Leave it running; Tauri builds the Rust side and opens the window.)

- [ ] **Step 2: Toggle Analysis and confirm native engine runs**

In the app window, flip **Analysis** on (start position). Within ~1s the eval bar / engine lines should populate and the depth counter should climb.

Expected (success criteria):
- The window does **not** freeze/crash (the wasm SIGSEGV is gone — we no longer load wasm under Tauri).
- Eval + best line stream; depth increases past 15.
- In the terminal running `tauri dev`, no `engine_start`/`spawn`/`sidecar` errors.

- [ ] **Step 3: Confirm a native process is actually running**

Run (in another terminal, while analyzing): `pgrep -af stockfish | grep -v node | head`
Expected: a `stockfish-x86_64-unknown-linux-gnu` process is alive — proving analysis is native, not wasm.

- [ ] **Step 4: Make a move; confirm analysis re-targets**

Play `e2e4` on the board. Expected: analysis restarts for the new position (new eval/lines), no crash, the same native process is reused.

- [ ] **Step 5: Record the result**

If all four checks pass, Phase 1 is done: the desktop app runs native Stockfish and the WebKitGTK freeze is resolved for real. Note any deviations for follow-up.

---

## Self-review / coverage

- Spec §3.1 (native backend via sidecar, `NativeEngine` on the `UciEngine` seam, browser keeps wasm) → Tasks 2, 3, 4. ✓
- Spec §3.3 components 1 (sidecar manager) + 3 (`NativeEngine`) → Tasks 2, 3. ✓
- Spec §4 (per-OS sidecars, safe-baseline microarch) → Task 0/1 wire the Linux dev path; cross-platform note documents the rest (full CI matrix is a packaging follow-up). ✓
- Deferred to Phase 2/3 (NOT in this plan): engine catalog data model, `EngineList` UI + states, download manager + on-demand nets, dev engine, `EvalFile` net switching, storage-locations (§3.2/3.4/3.6, §3.3 components 2/4/5). These get their own plans.

## Phase 2 / Phase 3 follow-ups (next plans)
1. **Phase 2:** engine catalog module; download manager (Rust: stream + SHA-256 + cancel/retry + progress `Channel`); store under `APP_DIR/engines/` (§3.6); `EngineList` Svelte component (Download / progress / cancel / retry / select states); `EvalFile` net switching; "Stockfish 18 · 108 MB" big-net option.
2. **Phase 3:** dev engine package (download dev binary + net); macOS notarized sidecar + Windows/macOS CI binary fetch; optional runtime AVX2/BMI2 build selection.
