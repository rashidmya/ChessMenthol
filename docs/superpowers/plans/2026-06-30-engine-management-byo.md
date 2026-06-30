# Engine Management — Bring-Your-Own UCI Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users run any UCI engine they already have on disk ("bring your own") alongside the always-present bundled Stockfish 18, validated and spawned by the existing native bridge.

**Architecture:** Widen the engine seam from "the one bundled engine" to "any UCI engine". A frontend `engineRegistry` (localStorage) owns the engine list — bundled Stockfish synthesized at runtime, external binaries persisted by path. The `engineController` resolves a record per selection and loads the bundled wasm/sidecar or an external binary; the thin Rust bridge (`engine_start`) is generalized from "the one sidecar" to "sidecar OR external path", plus a new `engine_validate` command. A native file picker (Tauri dialog plugin) drives "+ Add engine"; a registry-backed `EngineList` radio UI replaces the engine `<select>`.

**Tech Stack:** Svelte 5 (legacy `export let` syntax in this repo), TypeScript, Vitest (jsdom + `vi.hoisted` invoke/Channel mocks), Tauri 2 (Rust), `tauri-plugin-shell` 2.3.5, `tauri-plugin-dialog` 2.7.1 + `@tauri-apps/plugin-dialog`.

---

## File structure

### Created
| File | Responsibility |
|---|---|
| `frontend/src/lib/engineRegistry.ts` | Engine list owner: bundled Stockfish (synthesized, non-removable) + persisted external records; `list/get/add/remove/engineName`. |
| `frontend/src/components/EngineList.svelte` | Radio-list engine picker (replaces the `<select>`): select, remove external, "+ Add engine" → dialog → validate → add+select, inline add error. |
| `frontend/src/tests/engineRegistry.test.ts` | Registry unit tests (add/remove/persist/hydrate/corrupt; bundled always present & non-removable). |
| `frontend/src/tests/EngineList.test.ts` | UI tests for select/remove/add-flow (mocks `@tauri-apps/plugin-dialog` + `@tauri-apps/api/core`). |
| `frontend/src-tauri/src/engine.rs` → `#[cfg(test)] mod tests` | First Rust unit tests in the crate: `validate_engine` happy/timeout/exit/missing. |

### Modified
| File | Change |
|---|---|
| `frontend/src-tauri/Cargo.toml` | Add `tauri-plugin-dialog = "2"`. |
| `frontend/src-tauri/src/lib.rs` | Register `tauri_plugin_dialog::init()`; add `engine::engine_validate` to the invoke handler. |
| `frontend/src-tauri/src/engine.rs` | Add `EngineSpec` enum; generalize `engine_start` (bundled sidecar OR external path); add `engine_validate` + `validate_engine` helper + `EngineName`. |
| `frontend/src-tauri/capabilities/default.json` | Add `dialog:allow-open` permission. |
| `frontend/package.json` | Add `@tauri-apps/plugin-dialog` dependency. |
| `frontend/src/engine/nativeEngine.ts` | `loadNativeEngine(spec: EngineSpec, …)` — pass `{ spec }` (not `{ engineId }`) to `engine_start`. |
| `frontend/src/lib/engineClient.ts` | Generalize `engineController`: registry-driven `select`/`load` (identity-based reload), drop `presetFor`/`engineId()`/`desiredVariant`. |
| `frontend/src/core/orchestrator.ts` | Default `_engineId` `'stockfish_lite'` → `'stockfish'`. |
| `frontend/src/lib/options.ts` | Remove `ENGINES`/`EngineOption`/`engineLabel` (now registry-owned). |
| `frontend/src/components/EngineHeader.svelte` | Use `engineName` from registry instead of `engineLabel` from options. |
| `frontend/src/components/EngineSettings.svelte` | Replace the engine `<select>` with `<EngineList>`. |
| `frontend/src/tests/nativeEngine.test.ts` | Update for the new `spec` argument. |
| `frontend/src/tests/engineClientNative.test.ts` | Rewrite for registry-driven selection (bundled/external/reload). |
| `frontend/src/tests/EngineSettings.test.ts` | Drop the `<select>`/combobox test (keep the sliders test). |
| `frontend/src/tests/EngineHeader.test.ts` | `.eng` text `'Stockfish'` → `'Stockfish 18'`. |
| `frontend/src/tests/orchestrator.test.ts` | Update two now-stale `// … (stockfish_lite)` comments. |

### Deleted
| File | Reason |
|---|---|
| `frontend/src/tests/engineReload.test.ts` | Tests the removed full/lite **wasm variant** reload; replaced by identity-based reload coverage in `engineClientNative.test.ts`. |

### Gates (run from the noted dir)
- `cd frontend && npx vitest run` — all test files pass.
- `cd frontend && npm run check` — **0 errors, 0 warnings** (svelte-check + tsc).
- `cd frontend/src-tauri && cargo build` — compiles.
- `cd frontend/src-tauri && cargo test` — Rust unit tests pass.

---

## Task 1 — Rust: add the dialog plugin, capability, and JS package

**Files:**
- Modify `frontend/src-tauri/Cargo.toml` (line ~21, `[dependencies]`)
- Modify `frontend/src-tauri/src/lib.rs` (line ~12, builder)
- Modify `frontend/src-tauri/capabilities/default.json` (permissions array)
- Modify `frontend/package.json` (dependencies)

### Steps

1. - [ ] Add the dialog crate. In `frontend/src-tauri/Cargo.toml`, after the `tauri-plugin-shell = "2"` line, add:
   ```toml
   tauri-plugin-dialog = "2"
   ```

2. - [ ] Register the plugin. In `frontend/src-tauri/src/lib.rs`, change the builder's plugin line:
   ```rust
       tauri::Builder::default()
           .plugin(tauri_plugin_shell::init())
           .plugin(tauri_plugin_dialog::init())
           .manage(engine::EngineState::default())
   ```

3. - [ ] Grant the dialog open permission. In `frontend/src-tauri/capabilities/default.json`, add `"dialog:allow-open"` to the `permissions` array so it reads:
   ```json
   {
     "$schema": "../gen/schemas/desktop-schema.json",
     "identifier": "default",
     "description": "default capability for the main window",
     "windows": ["main"],
     "permissions": [
       "core:default",
       {
         "identifier": "shell:allow-execute",
         "allow": [{ "name": "stockfish", "sidecar": true, "args": true }]
       },
       "shell:allow-spawn",
       "dialog:allow-open"
     ]
   }
   ```

4. - [ ] Install the JS dialog plugin (updates `frontend/package.json` + lockfile):
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npm install @tauri-apps/plugin-dialog@^2
   ```
   Expected: `@tauri-apps/plugin-dialog` (2.7.x) added to `dependencies`.

5. - [ ] Build the Rust crate to pull the new crate and confirm registration:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend/src-tauri && cargo build
   ```
   Expected: `Compiling tauri-plugin-dialog v2.7.1` … `Finished \`dev\` profile`.

6. - [ ] Confirm the frontend still type-checks (no code change yet, sanity only):
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npm run check
   ```
   Expected: `svelte-check found 0 errors and 0 warnings`.

7. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): add Tauri dialog plugin for the engine file picker

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 2 — Rust: generalize `engine_start` to an engine spec (bundled | external path)

**Files:**
- Modify `frontend/src-tauri/src/engine.rs` (the `engine_start` command, lines ~17-74)

### Steps

1. - [ ] Add the `EngineSpec` type. In `frontend/src-tauri/src/engine.rs`, just below the `EngineState` struct (after line ~15), add:
   ```rust
   /// Which native engine `engine_start` should spawn. Sent from JS as
   /// `{ kind: "bundled" }` or `{ kind: "external", path: "/abs/path" }`.
   #[derive(serde::Deserialize)]
   #[serde(tag = "kind", rename_all = "lowercase")]
   pub enum EngineSpec {
       /// The app's bundled Stockfish sidecar.
       Bundled,
       /// A user-provided UCI binary referenced by absolute path.
       External { path: String },
   }
   ```

2. - [ ] Replace the whole `engine_start` command (the doc comment + `#[tauri::command] pub fn engine_start(...) { ... }`, lines ~17-74) with:
   ```rust
   /// Spawn a native UCI engine — the bundled Stockfish sidecar or a user-provided
   /// external binary — and stream its stdout lines to `on_line`. One engine at a
   /// time (held in EngineState); any previous engine is killed first.
   #[tauri::command]
   pub fn engine_start(
       app: AppHandle,
       state: State<'_, EngineState>,
       spec: EngineSpec,
       on_line: Channel<String>,
   ) -> Result<(), String> {
       // Kill any previous engine first.
       if let Some(child) = state.0.lock().unwrap().take() {
           let _ = child.kill();
       }

       let cmd = match spec {
           EngineSpec::Bundled => {
               // The net is bundled under resources/engine/; run Stockfish with that
               // folder as CWD so it auto-loads its default net without an explicit
               // EvalFile.
               let net_dir = app
                   .path()
                   .resolve("resources/engine", tauri::path::BaseDirectory::Resource)
                   .map_err(|e| format!("resolve net dir: {e}"))?;
               let cmd = app
                   .shell()
                   .sidecar("stockfish")
                   .map_err(|e| format!("sidecar: {e}"))?;
               // Packaged build: the bundled net is here and Stockfish auto-loads it
               // from CWD. `tauri dev` doesn't copy resources next to the dev binary,
               // so fall back to the engine's embedded net instead of failing spawn
               // with ENOENT.
               if net_dir.is_dir() { cmd.current_dir(net_dir) } else { cmd }
           }
           EngineSpec::External { path } => {
               // The user explicitly picked this binary (exactly like any desktop
               // chess GUI), so it runs Rust-side and is NOT gated by the JS shell
               // ACL. Its own net handling is the engine's concern (no CWD set).
               app.shell().command(path)
           }
       };

       let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;

       *state.0.lock().unwrap() = Some(child);

       // Forward stdout lines (already split on newline by the shell plugin) to the channel.
       tauri::async_runtime::spawn(async move {
           while let Some(event) = rx.recv().await {
               match event {
                   CommandEvent::Stdout(bytes) => {
                       let line = String::from_utf8_lossy(&bytes).to_string();
                       let _ = on_line.send(line);
                   }
                   CommandEvent::Stderr(bytes) => {
                       eprintln!("[engine stderr] {}", String::from_utf8_lossy(&bytes).trim_end());
                   }
                   CommandEvent::Error(err) => {
                       eprintln!("[engine error] {err}");
                   }
                   CommandEvent::Terminated(_) => break,
                   _ => {}
               }
           }
       });

       Ok(())
   }
   ```

3. - [ ] Build:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend/src-tauri && cargo build
   ```
   Expected: `Finished \`dev\` profile`. (Note: the frontend still sends `{ engineId }` until Task 5 — runtime is exercised only in the Task 11 manual e2e, by which point both sides use `spec`. Automated gates stay green throughout.)

4. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): generalize engine_start to bundled sidecar or external path

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 3 — Rust: add the `engine_validate` command

A synchronous command (mirrors the existing `std::process::Command` usage in `lib.rs`): spawn the binary, send `uci`, read stdout on a worker thread until `uciok`, enforce a timeout via `recv_timeout`, kill, return the reported `id name …`.

**Files:**
- Modify `frontend/src-tauri/src/engine.rs` (imports + new command at the end of the file, before any `#[cfg(test)]`)
- Modify `frontend/src-tauri/src/lib.rs` (invoke handler list)

### Steps

1. - [ ] Add std imports. At the top of `frontend/src-tauri/src/engine.rs`, change the import block (lines ~5-10) to:
   ```rust
   use std::io::{BufRead, BufReader, Write};
   use std::process::{Command, Stdio};
   use std::sync::mpsc;
   use std::sync::Mutex;
   use std::time::Duration;

   use tauri::ipc::Channel;
   use tauri::{AppHandle, Manager, State};
   use tauri_plugin_shell::process::{CommandChild, CommandEvent};
   use tauri_plugin_shell::ShellExt;
   ```
   (`Command` here is `std::process::Command`; the shell plugin's `Command` is only ever produced via `.sidecar()`/`.command()` and never named, so there is no clash.)

2. - [ ] Append the validate command + helper at the end of `frontend/src-tauri/src/engine.rs` (after `engine_stop`, before the test module added in Task 4):
   ```rust
   /// The engine's reported `id name …`, returned to JS by `engine_validate`.
   #[derive(serde::Serialize)]
   pub struct EngineName {
       pub name: String,
   }

   /// Validate a UCI engine binary: spawn it, send `uci`, and read stdout until
   /// `uciok` (or timeout). Returns the engine's reported `id name …` so the
   /// frontend can label it in the registry. Used by "+ Add engine" before adding.
   #[tauri::command]
   pub fn engine_validate(path: String) -> Result<EngineName, String> {
       validate_engine(&path, Duration::from_secs(10)).map(|name| EngineName { name })
   }

   /// Core of `engine_validate`, timeout-parameterized so unit tests can exercise
   /// the timeout branch quickly. Returns the `id name` text on success.
   fn validate_engine(path: &str, timeout: Duration) -> Result<String, String> {
       let mut child = Command::new(path)
           .stdin(Stdio::piped())
           .stdout(Stdio::piped())
           .stderr(Stdio::null())
           .spawn()
           .map_err(|e| format!("spawn {path}: {e}"))?;

       child
           .stdin
           .as_mut()
           .ok_or("no stdin")?
           .write_all(b"uci\n")
           .map_err(|e| format!("write: {e}"))?;

       // Read stdout on a worker thread and report over a channel, so the caller can
       // enforce a timeout: an engine that never handshakes must not hang us. After
       // we kill the child below its stdout closes, the BufReader hits EOF, and the
       // detached thread exits.
       let stdout = child.stdout.take().ok_or("no stdout")?;
       let (tx, rx) = mpsc::channel::<Result<String, String>>();
       std::thread::spawn(move || {
           let mut name: Option<String> = None;
           for line in BufReader::new(stdout).lines() {
               let line = match line {
                   Ok(l) => l,
                   Err(_) => break,
               };
               let line = line.trim();
               if let Some(rest) = line.strip_prefix("id name ") {
                   name = Some(rest.trim().to_string());
               }
               if line == "uciok" {
                   let _ = tx.send(Ok(name.clone().unwrap_or_else(|| "UCI engine".to_string())));
                   return;
               }
           }
           let _ = tx.send(Err("engine exited before announcing uciok".to_string()));
       });

       let outcome = rx.recv_timeout(timeout);
       let _ = child.kill();
       let _ = child.wait();
       match outcome {
           Ok(result) => result,
           Err(_) => Err("engine did not respond to `uci` in time".to_string()),
       }
   }
   ```

3. - [ ] Register the command. In `frontend/src-tauri/src/lib.rs`, extend the `generate_handler!` list:
   ```rust
           .invoke_handler(tauri::generate_handler![
               capture_frame,
               engine::engine_start,
               engine::engine_send,
               engine::engine_stop,
               engine::engine_validate
           ])
   ```

4. - [ ] Build:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend/src-tauri && cargo build
   ```
   Expected: `Finished \`dev\` profile` (one `warning: function \`validate_engine\` is never used` may appear only if the command wiring is omitted — it should NOT appear here since `engine_validate` calls it).

5. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): add engine_validate command (uci handshake + name)

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 4 — Rust: first unit tests in the crate (`validate_engine`)

**Files:**
- Modify `frontend/src-tauri/src/engine.rs` (append `#[cfg(test)] mod tests`)

### Steps

1. - [ ] Append the test module at the very end of `frontend/src-tauri/src/engine.rs`:
   ```rust
   #[cfg(test)]
   mod tests {
       use super::*;
       use std::path::PathBuf;

       /// The bundled Stockfish sidecar binary for the host target, if present.
       /// (`src-tauri/binaries/stockfish-<triple>`.) Returns None on a fresh
       /// checkout that hasn't fetched the binary, so the happy-path test skips.
       fn bundled_stockfish() -> Option<PathBuf> {
           let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
           std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
               p.file_name()
                   .and_then(|n| n.to_str())
                   .map(|n| n.starts_with("stockfish"))
                   .unwrap_or(false)
           })
       }

       #[test]
       fn validate_reports_name_for_a_real_uci_engine() {
           let Some(sf) = bundled_stockfish() else {
               eprintln!("skip: no bundled stockfish binary in src-tauri/binaries");
               return;
           };
           let name = validate_engine(&sf.to_string_lossy(), Duration::from_secs(10))
               .expect("bundled stockfish should validate");
           assert!(
               name.to_lowercase().contains("stockfish"),
               "expected a Stockfish id name, got {name:?}"
           );
       }

       #[test]
       fn validate_errors_on_a_missing_binary() {
           let err = validate_engine("/nonexistent/engine/binary", Duration::from_secs(1))
               .unwrap_err();
           assert!(err.contains("spawn"), "got {err:?}");
       }

       #[cfg(unix)]
       #[test]
       fn validate_rejects_a_binary_that_exits_without_uciok() {
           // /bin/true exits immediately and never prints `uciok`.
           let err = validate_engine("/bin/true", Duration::from_secs(5)).unwrap_err();
           assert!(err.contains("uciok") || err.contains("exited"), "got {err:?}");
       }

       #[cfg(unix)]
       #[test]
       fn validate_times_out_on_a_binary_that_never_handshakes() {
           // /bin/cat echoes our `uci` but never prints `uciok` and never exits, so the
           // read must hit the timeout. A short timeout keeps the test fast.
           let err = validate_engine("/bin/cat", Duration::from_millis(300)).unwrap_err();
           assert!(err.contains("in time"), "expected a timeout error, got {err:?}");
       }
   }
   ```

2. - [ ] Run the Rust tests:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend/src-tauri && cargo test
   ```
   Expected:
   ```
   running 4 tests
   test engine::tests::validate_errors_on_a_missing_binary ... ok
   test engine::tests::validate_rejects_a_binary_that_exits_without_uciok ... ok
   test engine::tests::validate_times_out_on_a_binary_that_never_handshakes ... ok
   test engine::tests::validate_reports_name_for_a_real_uci_engine ... ok
   test result: ok. 4 passed; 0 failed
   ```
   (If the bundled binary is absent, the happy-path test prints `skip:` and still counts as `ok`.)

3. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   test(engine): first crate unit tests for engine_validate

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 5 — Frontend: generalize `loadNativeEngine` to take an `EngineSpec` (TDD)

**Files:**
- Modify `frontend/src/tests/nativeEngine.test.ts`
- Modify `frontend/src/engine/nativeEngine.ts`

### Steps

1. - [ ] Update the test first. Replace `frontend/src/tests/nativeEngine.test.ts` in full with:
   ```ts
   import { describe, it, expect, vi, beforeEach } from 'vitest';

   // Mock @tauri-apps/api/core: capture invoke calls; Channel is a plain object whose
   // onmessage we can fire to simulate engine stdout.
   // vi.hoisted() is required because vi.mock factories are hoisted above module-level
   // declarations; `class` and `const` have TDZ, so we must hoist them explicitly.
   const { invokeMock, FakeChannel } = vi.hoisted(() => {
     const invokeMock = vi.fn(async (..._args: unknown[]): Promise<void> => {});
     class FakeChannel { onmessage: ((m: string) => void) | null = null; }
     return { invokeMock, FakeChannel };
   });
   vi.mock('@tauri-apps/api/core', () => ({
     invoke: (...a: unknown[]) => invokeMock(...a),
     Channel: FakeChannel,
   }));

   import { loadNativeEngine } from '../engine/nativeEngine';
   import { Channel } from '@tauri-apps/api/core';

   beforeEach(() => invokeMock.mockClear());

   // Resolve loadNativeEngine by making engine_start fire `uciok` through the channel.
   function autoUciok() {
     invokeMock.mockImplementation(async (...a: unknown[]) => {
       const cmd = a[0] as string;
       const args = a[1] as { onLine?: { onmessage?: (m: string) => void } } | undefined;
       if (cmd === 'engine_start') queueMicrotask(() => args?.onLine?.onmessage?.('uciok'));
     });
   }

   describe('loadNativeEngine', () => {
     it('starts the bundled engine, resolves on uciok, and routes lines to onLine', async () => {
       autoUciok();
       const engine = await loadNativeEngine({ kind: 'bundled' });
       expect(invokeMock).toHaveBeenCalledWith('engine_start', expect.objectContaining({ spec: { kind: 'bundled' } }));

       const lines: string[] = [];
       engine.onLine((l) => lines.push(l));
       const startArgs = invokeMock.mock.calls.find((c) => c[0] === 'engine_start')![1] as { onLine: InstanceType<typeof Channel> & { onmessage: (m: string) => void } };
       const ch = startArgs.onLine;
       ch.onmessage('info depth 1 score cp 20\nbestmove e2e4');
       expect(lines).toEqual(['info depth 1 score cp 20', 'bestmove e2e4']);
     });

     it('forwards an external engine spec to engine_start', async () => {
       autoUciok();
       await loadNativeEngine({ kind: 'external', path: '/opt/engines/foo' });
       expect(invokeMock).toHaveBeenCalledWith(
         'engine_start',
         expect.objectContaining({ spec: { kind: 'external', path: '/opt/engines/foo' } }),
       );
     });

     it('send() forwards a UCI line via engine_send', async () => {
       autoUciok();
       const engine = await loadNativeEngine({ kind: 'bundled' });
       invokeMock.mockClear();
       engine.send('go depth 12');
       expect(invokeMock).toHaveBeenCalledWith('engine_send', { line: 'go depth 12' });
     });

     it('dispose() calls engine_stop', async () => {
       autoUciok();
       const engine = await loadNativeEngine({ kind: 'bundled' });
       invokeMock.mockClear();
       engine.dispose();
       expect(invokeMock).toHaveBeenCalledWith('engine_stop');
     });

     it('rejects after timeoutMs if uciok never arrives, and stops the engine', async () => {
       vi.useFakeTimers();
       invokeMock.mockResolvedValue(undefined); // engine_start resolves but no uciok ever comes
       const p = loadNativeEngine({ kind: 'bundled' }, 500);
       const assertion = expect(p).rejects.toThrow('native engine failed to initialize within 500ms');
       await vi.advanceTimersByTimeAsync(500);
       await assertion;
       expect(invokeMock).toHaveBeenCalledWith('engine_stop');
       vi.useRealTimers();
     });
   });
   ```

2. - [ ] Run it; expect failure (impl still takes a string + sends `engineId`):
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/nativeEngine.test.ts
   ```
   Expected: FAIL — e.g. `expected "engine_start" to be called with ... { spec: { kind: 'bundled' } }` but called with `{ engineId: {…} }`, and a TS argument-type error for `{ kind: 'bundled' }`.

3. - [ ] Implement. Replace `frontend/src/engine/nativeEngine.ts` in full with:
   ```ts
   // frontend/src/engine/nativeEngine.ts
   // UciEngine implementation backed by a native UCI engine process (Tauri only):
   // the bundled Stockfish sidecar OR a user-provided external binary. Mirrors
   // WorkerEngine's contract: resolves once the engine answers `uciok`, splits
   // batched output into trimmed lines, and routes them to the registered listener.
   import { invoke, Channel } from '@tauri-apps/api/core';
   import type { UciEngine } from './engine';

   /** Which native engine to spawn: the bundled Stockfish sidecar or an external binary. */
   export type EngineSpec = { kind: 'bundled' } | { kind: 'external'; path: string };

   export async function loadNativeEngine(spec: EngineSpec, timeoutMs = 10_000): Promise<UciEngine> {
     let listener: ((line: string) => void) | null = null;
     // Buffer lines that arrive before onLine() is called (e.g. uciok from engine_start).
     const lineBuffer: string[] = [];

     const channel = new Channel<string>();
     channel.onmessage = (chunk: string) => {
       for (const raw of String(chunk).split('\n')) {
         const line = raw.trim();
         if (!line) continue;
         if (listener) {
           listener(line);
         } else {
           lineBuffer.push(line);
         }
       }
     };

     await invoke('engine_start', { spec, onLine: channel });

     const engine: UciEngine = {
       send: (cmd: string) => { invoke('engine_send', { line: cmd }).catch(() => {}); },
       onLine: (cb: (line: string) => void) => {
         listener = cb;
         // Flush lines that arrived before the listener was registered.
         for (const line of lineBuffer) cb(line);
         lineBuffer.length = 0;
       },
       dispose: () => { invoke('engine_stop').catch(() => {}); },
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

4. - [ ] Re-run; expect pass:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/nativeEngine.test.ts
   ```
   Expected: `✓ src/tests/nativeEngine.test.ts (5)` … `Test Files 1 passed`.

5. - [ ] Note: `engineClient.ts` still calls `loadNativeEngine(engineId(v))` (string) — `npm run check` will flag this. It is fixed in Task 7; do not run the full `check` gate here. Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): loadNativeEngine takes an EngineSpec (bundled | external)

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 6 — Frontend: `engineRegistry` (TDD)

**Files:**
- Create `frontend/src/tests/engineRegistry.test.ts`
- Create `frontend/src/lib/engineRegistry.ts`

### Steps

1. - [ ] Write the test first. Create `frontend/src/tests/engineRegistry.test.ts`:
   ```ts
   import { describe, it, expect, beforeEach } from 'vitest';
   import { list, get, add, remove, engineName, BUNDLED, KEY, type EngineRecord } from '../lib/engineRegistry';

   const ext = (over: Partial<EngineRecord> = {}): EngineRecord => ({
     id: 'e1', name: 'My Engine', kind: 'external', path: '/opt/x', ...over,
   });

   describe('engineRegistry', () => {
     beforeEach(() => localStorage.clear());

     it('lists only the bundled Stockfish by default', () => {
       expect(list()).toEqual([BUNDLED]);
       expect(BUNDLED).toEqual({ id: 'stockfish', name: 'Stockfish 18', kind: 'bundled' });
     });

     it('get() resolves the bundled engine and returns undefined for unknown ids', () => {
       expect(get('stockfish')).toEqual(BUNDLED);
       expect(get('nope')).toBeUndefined();
     });

     it('engineName() returns the name, falling back to the id', () => {
       expect(engineName('stockfish')).toBe('Stockfish 18');
       expect(engineName('mystery')).toBe('mystery');
     });

     it('add() appends an external engine and persists it', () => {
       add(ext());
       expect(list()).toHaveLength(2);
       expect(get('e1')).toEqual(ext());
       const stored = JSON.parse(localStorage.getItem(KEY)!);
       expect(stored).toEqual([ext()]);
     });

     it('add() ignores a bundled record and duplicate ids', () => {
       add({ id: 'stockfish', name: 'X', kind: 'bundled' });
       add(ext());
       add(ext({ name: 'dupe' }));
       expect(list()).toHaveLength(2); // bundled + one external
     });

     it('remove() drops an external engine but never the bundled one', () => {
       add(ext());
       remove('stockfish');
       expect(get('stockfish')).toEqual(BUNDLED);
       remove('e1');
       expect(get('e1')).toBeUndefined();
       expect(list()).toEqual([BUNDLED]);
     });

     it('hydrates external engines persisted by a previous session', () => {
       localStorage.setItem(KEY, JSON.stringify([ext({ id: 'saved', name: 'Saved' })]));
       expect(get('saved')?.name).toBe('Saved');
       expect(list()).toHaveLength(2);
     });

     it('falls back to bundled-only on corrupt storage', () => {
       localStorage.setItem(KEY, '{not json');
       expect(list()).toEqual([BUNDLED]);
     });

     it('ignores malformed stored records', () => {
       localStorage.setItem(KEY, JSON.stringify([{ id: 'x' }, ext({ id: 'ok' })]));
       expect(list().map((e) => e.id)).toEqual(['stockfish', 'ok']);
     });
   });
   ```

2. - [ ] Run it; expect failure (no module):
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/engineRegistry.test.ts
   ```
   Expected: FAIL — `Failed to resolve import "../lib/engineRegistry"`.

3. - [ ] Implement. Create `frontend/src/lib/engineRegistry.ts`:
   ```ts
   // frontend/src/lib/engineRegistry.ts
   // Owns the user's engine list: one always-present bundled Stockfish plus any
   // "bring-your-own" external UCI binaries the user has added. External records
   // persist to localStorage; the bundled record is synthesized at runtime and can
   // never be removed. Mirrors the viewprefs.ts localStorage pattern.

   export type EngineKind = 'bundled' | 'external';

   export interface EngineRecord {
     id: string;                 // 'stockfish' (bundled) | uuid (external)
     name: string;               // 'Stockfish 18' | the engine's reported `id name`
     kind: EngineKind;
     path?: string;              // external only: absolute path to the binary
   }

   /** The bundled Stockfish — always first, never removable. */
   export const BUNDLED: EngineRecord = { id: 'stockfish', name: 'Stockfish 18', kind: 'bundled' };
   export const KEY = 'chessmenthol.engines';

   /** Load persisted EXTERNAL records (bundled is never persisted). */
   function loadExternal(): EngineRecord[] {
     try {
       const raw: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
       if (!Array.isArray(raw)) return [];
       return raw.filter(
         (r): r is EngineRecord =>
           !!r &&
           typeof (r as EngineRecord).id === 'string' &&
           typeof (r as EngineRecord).name === 'string' &&
           (r as EngineRecord).kind === 'external' &&
           typeof (r as EngineRecord).path === 'string',
       );
     } catch {
       return [];
     }
   }

   function saveExternal(records: EngineRecord[]): void {
     try {
       localStorage.setItem(KEY, JSON.stringify(records.filter((r) => r.kind === 'external')));
     } catch {
       /* ignore quota/availability errors */
     }
   }

   /** Full list: bundled Stockfish first, then external engines (in add order). */
   export function list(): EngineRecord[] {
     return [BUNDLED, ...loadExternal()];
   }

   /** Resolve a record by id (bundled or external), or undefined if unknown. */
   export function get(id: string): EngineRecord | undefined {
     return list().find((r) => r.id === id);
   }

   /** Human-readable name for an id (falls back to the id for unknown engines). */
   export function engineName(id: string): string {
     return get(id)?.name ?? id;
   }

   /** Add an external engine; ignores bundled records and duplicate ids. */
   export function add(record: EngineRecord): void {
     if (record.kind !== 'external') return;
     const ext = loadExternal();
     if (ext.some((r) => r.id === record.id)) return;
     saveExternal([...ext, record]);
   }

   /** Remove an external engine by id. The bundled engine is never removed. */
   export function remove(id: string): void {
     if (id === BUNDLED.id) return;
     saveExternal(loadExternal().filter((r) => r.id !== id));
   }
   ```

4. - [ ] Re-run; expect pass:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/engineRegistry.test.ts
   ```
   Expected: `✓ src/tests/engineRegistry.test.ts (9)` … `Test Files 1 passed`.

5. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   feat(engine): engineRegistry — bundled + bring-your-own engine list

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 7 — Frontend: generalize `engineController` to registry-driven selection (TDD)

Replace the full/lite **variant** machinery (`presetFor`, `engineId()`, `desiredVariant`) with **identity-based** selection: a record per id; switching to a different id disposes the live engine and reloads (a different binary/process); same-id is a no-op beyond re-applying Threads/Hash.

**Files:**
- Delete `frontend/src/tests/engineReload.test.ts`
- Modify `frontend/src/tests/engineClientNative.test.ts`
- Modify `frontend/src/lib/engineClient.ts` (the engine-controller section, lines ~47-166)

### Steps

1. - [ ] Delete the obsolete variant-reload test:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git rm frontend/src/tests/engineReload.test.ts
   ```

2. - [ ] Rewrite `frontend/src/tests/engineClientNative.test.ts` in full:
   ```ts
   import { describe, it, expect, vi, beforeEach } from 'vitest';

   // vi.mock factories are hoisted above imports, so the vars they reference must be
   // created inside vi.hoisted() (bare const/class would hit a TDZ error).
   const { loadNativeEngine, loadStockfish, isTauriMock } = vi.hoisted(() => {
     const fakeEngine = () => ({ send: vi.fn(), onLine: vi.fn(), dispose: vi.fn() });
     return {
       loadNativeEngine: vi.fn(async (..._a: unknown[]) => fakeEngine()),
       loadStockfish: vi.fn(async (..._a: unknown[]) => fakeEngine()),
       isTauriMock: vi.fn(() => true),
     };
   });

   vi.mock('../engine/nativeEngine', () => ({ loadNativeEngine: (...a: unknown[]) => loadNativeEngine(...a) }));
   vi.mock('../engine/engine', async (orig) => ({
     ...(await orig<typeof import('../engine/engine')>()),
     loadStockfish: (...a: unknown[]) => loadStockfish(...a),
     threadsAvailable: () => false,
   }));
   vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => isTauriMock(), Channel: class {} }));
   // engineClient.ts runs makeVisionTracker() at module load; hasNativeCapture() calls isTauri(),
   // which we mock to true — that would otherwise build a real `new Worker(...)`, unsupported under
   // jsdom and would crash the import. Force hasNativeCapture() false so no Worker is created;
   // engine SELECTION still uses the isTauri() mock above.
   vi.mock('../lib/capture', () => ({ hasNativeCapture: () => false, Capturer: class {} }));

   beforeEach(async () => {
     localStorage.clear(); // reset the engine registry between tests
     // engineController is a module singleton with a cached loadPromise; reset it so each
     // ensureEngine() actually re-runs load().
     const { engineController } = await import('../lib/engineClient');
     engineController.dispose();
     loadNativeEngine.mockClear();
     loadStockfish.mockClear();
     isTauriMock.mockReturnValue(true);
   });

   describe('engineController loader selection', () => {
     it('loads the bundled native sidecar under Tauri', async () => {
       const { engineController } = await import('../lib/engineClient');
       await engineController.ensureEngine();
       expect(loadNativeEngine).toHaveBeenCalledTimes(1);
       expect(loadNativeEngine).toHaveBeenCalledWith({ kind: 'bundled' });
       expect(loadStockfish).not.toHaveBeenCalled();
     });

     it('loads the wasm engine (loadStockfish) in a plain browser', async () => {
       isTauriMock.mockReturnValue(false);
       const { engineController } = await import('../lib/engineClient');
       await engineController.ensureEngine();
       expect(loadStockfish).toHaveBeenCalledTimes(1);
       expect(loadNativeEngine).not.toHaveBeenCalled();
     });

     it('passes an external engine path to the native loader', async () => {
       const { add } = await import('../lib/engineRegistry');
       add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/engines/foo' });
       const { engineController } = await import('../lib/engineClient');
       engineController.select('ext1');
       await engineController.ensureEngine();
       expect(loadNativeEngine).toHaveBeenCalledWith({ kind: 'external', path: '/opt/engines/foo' });
     });

     it('does not thread-clamp the native engine', async () => {
       // threadsAvailable() is mocked false (as on WebKitGTK); the native engine is a
       // separate process and must still get the configured Threads value, not clamped to 1.
       const { engineController } = await import('../lib/engineClient');
       engineController.configure({ threads: 4, hash: null });
       const engine = await engineController.ensureEngine();
       expect(engine.send).toHaveBeenCalledWith('setoption name Threads value 4');
       expect(engine.send).not.toHaveBeenCalledWith('setoption name Threads value 1');
     });

     it('keeps the live engine when re-selecting the same id', async () => {
       const { engineController } = await import('../lib/engineClient');
       const a = await engineController.ensureEngine();
       engineController.select('stockfish'); // same as the default desiredId
       expect(loadNativeEngine).toHaveBeenCalledTimes(1); // no reload
       expect(engineController.currentEngine()).toBe(a);
       expect(a.dispose).not.toHaveBeenCalled();
     });

     it('disposes + reloads when switching to a different engine id', async () => {
       const { add } = await import('../lib/engineRegistry');
       add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/engines/foo' });
       const { engineController } = await import('../lib/engineClient');
       const a = await engineController.ensureEngine(); // bundled
       expect(loadNativeEngine).toHaveBeenCalledTimes(1);
       engineController.select('ext1'); // different id → drop + reload
       expect(a.dispose).toHaveBeenCalled();
       expect(engineController.currentEngine()).toBeNull();
       const b = await engineController.ensureEngine();
       expect(loadNativeEngine).toHaveBeenCalledTimes(2);
       expect(b).not.toBe(a);
     });
   });
   ```

3. - [ ] Run it; expect failure (controller still variant-based, calls `loadNativeEngine('stockfish')`):
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/engineClientNative.test.ts
   ```
   Expected: FAIL — `loadNativeEngine` called with `"stockfish"` not `{ kind: 'bundled' }`; the external-path and reload tests fail.

4. - [ ] Implement. In `frontend/src/lib/engineClient.ts`, add the registry import after the `loadNativeEngine` import (line ~20):
   ```ts
   import { get as getEngine, type EngineRecord } from './engineRegistry';
   ```

5. - [ ] Replace the entire engine-controller section — from `// ─── engine controller (lazy loader) ──` through the end of the IIFE (the closing `})();` at line ~166), i.e. the `presetFor` function, `clampThreads`, and the whole `export const engineController = (() => { … })();` — with:
   ```ts
   // ─── engine controller (lazy loader) ──────────────────────────────────────

   function clampThreads(desired: number | null): number | undefined {
     if (desired === null) return undefined;
     // The native engine (Tauri) is a separate process that always supports threads; the
     // "single-threaded wasm" clamp only applies to the in-webview wasm/asm.js build.
     if (isTauri()) return desired;
     if (!threadsAvailable()) return 1; // single-threaded wasm: never set Threads > 1
     return desired;
   }

   export const engineController: OrchestratorEngine & {
     select(id: string): void;
     ensureEngine(): Promise<UciEngine>;
     currentEngine(): UciEngine | null;
     dispose(): void;
   } = (() => {
     let engine: UciEngine | null = null;
     let loadPromise: Promise<UciEngine> | null = null;
     let desired = { threads: null as number | null, hash: null as number | null };
     // The engine id the next load() will commit. select() updates it; a cross-id
     // switch mid-load self-heals to this value (see load()).
     let desiredId = 'stockfish';

     function applyIfLoaded(): void {
       if (engine) {
         configureEngine(engine, {
           threads: clampThreads(desired.threads),
           hash: desired.hash ?? undefined,
         });
       }
     }

     // Resolve a registry record for `id`, falling back to the bundled Stockfish for
     // an unknown/stale id (e.g. a removed external engine) so analysis keeps working.
     function recordFor(id: string): EngineRecord {
       return getEngine(id) ?? getEngine('stockfish')!;
     }

     // Build an engine for `id`. Desktop (Tauri): the native sidecar (bundled) or the
     // user's external binary. Plain browser: only the bundled wasm/asm.js engine
     // exists (external engines are Tauri-only), so any id loads via loadStockfish().
     function load(id: string): Promise<UciEngine> {
       const rec = recordFor(id);
       const loader = isTauri()
         ? loadNativeEngine(
             rec.kind === 'external' && rec.path
               ? { kind: 'external', path: rec.path }
               : { kind: 'bundled' },
           )
         : loadStockfish();
       return loader.then((e) => {
         // If the desired engine changed while this one was loading, it's the wrong
         // engine — drop it and reload the currently-desired one. The awaited promise
         // therefore self-heals to the final selection.
         if (id !== desiredId) {
           e.dispose();
           return load(desiredId);
         }
         engine = e;
         applyIfLoaded();
         return e;
       });
     }

     return {
       select(id: string): void {
         if (id !== desiredId) {
           desiredId = id;
           // A different engine is a different process/binary, so the live engine can't
           // be reused: drop it AND any in-flight load. LazySession then sees
           // currentEngine() === null and rebuilds on the newly-loaded engine.
           engine?.dispose();
           engine = null;
           loadPromise = null;
         }
         applyIfLoaded();
       },

       configure(opts: { threads: number | null; hash: number | null }): void {
         // Override desired, but only for non-null values (preserve existing entries).
         if (opts.threads !== null) desired = { ...desired, threads: opts.threads };
         if (opts.hash !== null) desired = { ...desired, hash: opts.hash };
         applyIfLoaded();
       },

       ensureEngine(): Promise<UciEngine> {
         if (!loadPromise) {
           const p = load(desiredId);
           loadPromise = p;
           // Don't cache a failed load — clear it so a later start() can retry.
           // Identity-guarded so a late rejection from a superseded load can't null
           // a newer loadPromise.
           p.catch(() => { if (loadPromise === p) loadPromise = null; });
         }
         return loadPromise;
       },

       currentEngine(): UciEngine | null {
         return engine;
       },

       dispose(): void {
         engine?.dispose();
         engine = null;
         loadPromise = null;
         desiredId = 'stockfish';
       },
     };
   })();
   ```

6. - [ ] Re-run the controller test; expect pass:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/engineClientNative.test.ts
   ```
   Expected: `✓ src/tests/engineClientNative.test.ts (6)` … `Test Files 1 passed`.

7. - [ ] Run the full suite to confirm nothing else regressed. This task changed only the controller internals, rewrote `engineClientNative.test.ts`, and deleted `engineReload.test.ts` — so the **whole suite should be green**. The other engine-related tests (`engineClient.test.ts`, `EngineHeader.test.ts`, `EngineSettings.test.ts`, `smoke.test.ts`, `orchestrator.test.ts`, `engineLoad.test.ts`, `engineThreads.test.ts`) still use the old `engineLabel`/`<select>`/`stockfish_lite` default but remain valid here — they're migrated in Tasks 8-9. (`engineLoad`/`engineThreads` exercise `engine.ts`'s `loadStockfish`/`threadsAvailable` directly, which this plan never touches.) Run:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run
   ```
   Expected: all test files pass (`0 failed`). If any file fails, stop and debug before continuing.

8. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   refactor(engine): registry-driven engineController (identity-based reload)

   Replaces the full/lite wasm-variant machinery with per-record engine
   identity: switching engines disposes + reloads; same id only re-applies
   Threads/Hash. Drops presetFor/engineId()/desiredVariant.

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 8 — Frontend: single bundled default + registry-backed engine name

Make `'stockfish'` the default engine id and resolve the header's engine label from the registry.

**Files:**
- Modify `frontend/src/core/orchestrator.ts` (line ~139)
- Modify `frontend/src/components/EngineHeader.svelte` (import + `.eng` span)
- Modify `frontend/src/tests/EngineHeader.test.ts` (`.eng` assertion)
- Modify `frontend/src/tests/orchestrator.test.ts` (two stale comments)

### Steps

1. - [ ] Change the orchestrator default. In `frontend/src/core/orchestrator.ts`, line ~139:
   ```ts
     _engineId = 'stockfish';
   ```
   (was `_engineId = 'stockfish_lite';`)

2. - [ ] Point the header at the registry. In `frontend/src/components/EngineHeader.svelte`, replace the options import (line ~6):
   ```ts
     import { engineName } from '../lib/engineRegistry';
   ```
   (was `import { engineLabel } from '../lib/options';`)

3. - [ ] Update the engine tag in `frontend/src/components/EngineHeader.svelte` (line ~44):
   ```svelte
     <span class="tag">depth {depth}<span class="bar">|</span><span class="eng">{engineName(engineId)}</span></span>
   ```
   (was `{engineLabel(engineId)}`)

4. - [ ] Update the header test. In `frontend/src/tests/EngineHeader.test.ts`, the "tag shows depth and engine name" test (line ~28):
   ```ts
     expect(container.querySelector('.eng')?.textContent).toBe('Stockfish 18');
   ```
   (was `.toBe('Stockfish')`)

5. - [ ] Update the two stale comments in `frontend/src/tests/orchestrator.test.ts` so they no longer reference the removed `stockfish_lite` default. Line ~176:
   ```ts
       // set_engine always restarts the session, even when the id is unchanged.
   ```
   Line ~246:
   ```ts
       // set_engine after set_options re-applies the user's Threads/Hash to the new engine.
   ```

6. - [ ] Gate — type-check (EngineSettings still imports `ENGINES` and renders the `<select>`; that's fine until Task 9):
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npm run check
   ```
   Expected: `svelte-check found 0 errors and 0 warnings`. (`engineLabel`/`ENGINES`/`EngineOption` are now unused exports in `options.ts` — unused exports are allowed; they are removed in Task 9.)

7. - [ ] Gate — full vitest:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run
   ```
   Expected: all test files pass (`Test Files … passed`, `0 failed`).

8. - [ ] Commit:
   ```bash
   cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
   refactor(engine): default to bundled 'stockfish'; header name from registry

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Task 9 — Frontend: `EngineList` UI + wire into `EngineSettings` (TDD)

Build the radio-list picker (select / remove external / "+ Add engine" → dialog → validate → add+select), replace the `<select>` in `EngineSettings`, and retire the now-unused `options.ts` engine exports.

**Files:**
- Create `frontend/src/tests/EngineList.test.ts`
- Create `frontend/src/components/EngineList.svelte`
- Modify `frontend/src/components/EngineSettings.svelte`
- Modify `frontend/src/tests/EngineSettings.test.ts` (drop the combobox test)
- Modify `frontend/src/lib/options.ts` (remove `ENGINES`/`EngineOption`/`engineLabel`)

### Steps

1. - [ ] Write the UI test first. Create `frontend/src/tests/EngineList.test.ts`:
   ```ts
   import { describe, it, expect, vi, beforeEach } from 'vitest';
   import { render, fireEvent } from '@testing-library/svelte';

   const { invokeMock, openMock, isTauriMock } = vi.hoisted(() => ({
     invokeMock: vi.fn(async (..._a: unknown[]) => ({ name: 'Komodo 14' })),
     openMock: vi.fn(async (..._a: unknown[]) => '/opt/engines/komodo' as string | null),
     isTauriMock: vi.fn(() => true),
   }));
   vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a), isTauri: () => isTauriMock() }));
   vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => openMock(...a) }));

   import EngineList from '../components/EngineList.svelte';
   import { list } from '../lib/engineRegistry';

   beforeEach(() => {
     localStorage.clear();
     invokeMock.mockReset();
     openMock.mockReset();
     isTauriMock.mockReturnValue(true);
     invokeMock.mockResolvedValue({ name: 'Komodo 14' });
     openMock.mockResolvedValue('/opt/engines/komodo');
   });

   describe('EngineList', () => {
     it('renders the bundled Stockfish row with no remove control', () => {
       const { getByText, queryByLabelText } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine: vi.fn() } });
       expect(getByText('Stockfish 18')).toBeTruthy();
       expect(queryByLabelText('Remove Stockfish 18')).toBeNull();
     });

     it('hides "+ Add engine" in a plain browser', () => {
       isTauriMock.mockReturnValue(false);
       const { queryByText } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine: vi.fn() } });
       expect(queryByText('+ Add engine')).toBeNull();
     });

     it('clicking a row selects that engine', async () => {
       const { add } = await import('../lib/engineRegistry');
       add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/x' });
       const onSetEngine = vi.fn();
       const { getByText } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine } });
       await fireEvent.click(getByText('My Engine'));
       expect(onSetEngine).toHaveBeenCalledWith('ext1');
     });

     it('add flow: validates, adds + selects the engine', async () => {
       const onSetEngine = vi.fn();
       const { getByText } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine } });
       await fireEvent.click(getByText('+ Add engine'));
       await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('engine_validate', { path: '/opt/engines/komodo' }));
       await vi.waitFor(() => expect(onSetEngine).toHaveBeenCalledTimes(1));
       expect(list().some((e) => e.name === 'Komodo 14' && e.path === '/opt/engines/komodo')).toBe(true);
       const newId = onSetEngine.mock.calls[0][0];
       expect(newId).not.toBe('stockfish');
     });

     it('add failure surfaces an error and adds nothing', async () => {
       invokeMock.mockRejectedValue('not a uci engine');
       const onSetEngine = vi.fn();
       const { getByText, findByRole } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine } });
       await fireEvent.click(getByText('+ Add engine'));
       const alert = await findByRole('alert');
       expect(alert.textContent).toMatch(/isn't a working UCI engine/i);
       expect(onSetEngine).not.toHaveBeenCalled();
       expect(list()).toHaveLength(1); // only bundled
     });

     it('cancelling the picker adds nothing', async () => {
       openMock.mockResolvedValue(null);
       const onSetEngine = vi.fn();
       const { getByText } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine } });
       await fireEvent.click(getByText('+ Add engine'));
       await vi.waitFor(() => expect(openMock).toHaveBeenCalled());
       expect(invokeMock).not.toHaveBeenCalled();
       expect(onSetEngine).not.toHaveBeenCalled();
       expect(list()).toHaveLength(1);
     });

     it('removing the selected external engine falls back to bundled', async () => {
       const { add } = await import('../lib/engineRegistry');
       add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/x' });
       const onSetEngine = vi.fn();
       const { getByLabelText } = render(EngineList, { props: { engineId: 'ext1', onSetEngine } });
       await fireEvent.click(getByLabelText('Remove My Engine'));
       expect(onSetEngine).toHaveBeenCalledWith('stockfish');
       expect(list().some((e) => e.id === 'ext1')).toBe(false);
     });
   });
   ```

2. - [ ] Run it; expect failure (no component):
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/EngineList.test.ts
   ```
   Expected: FAIL — `Failed to resolve import "../components/EngineList.svelte"`.

3. - [ ] Implement the component. Create `frontend/src/components/EngineList.svelte`:
   ```svelte
   <script lang="ts">
     import { invoke, isTauri } from '@tauri-apps/api/core';
     import { open } from '@tauri-apps/plugin-dialog';
     import { list, add, remove, type EngineRecord } from '../lib/engineRegistry';

     export let engineId: string = 'stockfish';
     export let onSetEngine: (id: string) => void = () => {};

     // Local snapshot of the registry; refreshed after add/remove.
     let engines: EngineRecord[] = list();
     let validating = false;
     let addError: string | null = null;
     // "+ Add engine" and external engines are Tauri-only (native picker + spawn).
     const canAdd = isTauri();

     function refresh(): void { engines = list(); }

     function select(id: string): void {
       if (id !== engineId) onSetEngine(id);
     }

     function removeEngine(id: string): void {
       remove(id);
       refresh();
       if (id === engineId) onSetEngine('stockfish'); // fall back to bundled
     }

     async function addEngine(): Promise<void> {
       addError = null;
       let path: string | null;
       try {
         const picked = await open({ multiple: false, directory: false, title: 'Choose a UCI engine' });
         path = typeof picked === 'string' ? picked : null;
       } catch (e) {
         addError = `couldn't open the file picker: ${e instanceof Error ? e.message : String(e)}`;
         return;
       }
       if (!path) return; // user cancelled
       validating = true;
       try {
         const { name } = await invoke<{ name: string }>('engine_validate', { path });
         const record: EngineRecord = { id: crypto.randomUUID(), name, kind: 'external', path };
         add(record);
         refresh();
         onSetEngine(record.id);
       } catch (e) {
         addError = `${path} isn't a working UCI engine (${e instanceof Error ? e.message : String(e)})`;
       } finally {
         validating = false;
       }
     }
   </script>

   <div class="elist" role="radiogroup" aria-label="Engine">
     {#each engines as eng (eng.id)}
       <div class="erow" class:sel={eng.id === engineId}>
         <button
           type="button"
           role="radio"
           aria-checked={eng.id === engineId}
           class="pick"
           on:click={() => select(eng.id)}
         >
           <span class="dot">{eng.id === engineId ? '●' : '○'}</span>
           <span class="name">{eng.name}</span>
           {#if eng.kind === 'external'}<span class="path">{eng.path}</span>{/if}
         </button>
         {#if eng.kind === 'external'}
           <button type="button" class="rm" aria-label={`Remove ${eng.name}`} on:click={() => removeEngine(eng.id)}>
             {'✕'}
           </button>
         {/if}
       </div>
     {/each}

     {#if validating}
       <div class="erow validating"><span class="dot">{'…'}</span><span class="name">validating…</span></div>
     {/if}

     {#if canAdd}
       <button type="button" class="addbtn" on:click={addEngine} disabled={validating}>+ Add engine</button>
     {/if}

     {#if addError}<div class="adderr" role="alert">{addError}</div>{/if}
   </div>

   <style>
     .elist { display: flex; flex-direction: column; gap: 4px; }
     .erow { display: flex; align-items: center; gap: 6px; }
     .pick { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0;
       font-family: var(--sans); font-size: 12px; color: var(--ink);
       background: var(--paper-2); border: 1px solid var(--keyline-2); border-radius: 6px;
       padding: 7px 10px; cursor: pointer; text-align: left; transition: .14s; }
     .pick:hover { border-color: var(--green); }
     .erow.sel .pick { border-color: var(--green); background: #fff; }
     .pick .dot { flex: none; color: var(--green); font-size: 11px; line-height: 1; }
     .pick .name { font-weight: 600; white-space: nowrap; }
     .pick .path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
       font-family: var(--mono); font-size: 9.5px; color: var(--ink-3); }
     .rm { flex: none; width: 22px; height: 22px; display: grid; place-items: center;
       border: 1px solid var(--keyline-2); background: var(--paper-2); border-radius: 6px;
       cursor: pointer; color: var(--ink-3); font-size: 11px; line-height: 1; transition: .14s; }
     .rm:hover { border-color: #c0392b; color: #c0392b; background: #fff; }
     .validating { padding: 7px 10px; font-family: var(--sans); font-size: 12px; color: var(--ink-3); }
     .validating .dot { margin-right: 8px; }
     .addbtn { font-family: var(--mono); font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase;
       color: var(--ink-2); font-weight: 700; background: transparent; border: 1px dashed var(--keyline-2);
       border-radius: 6px; padding: 7px 10px; cursor: pointer; transition: .14s; }
     .addbtn:hover:not(:disabled) { border-color: var(--green); color: var(--green); }
     .addbtn:disabled { opacity: .5; cursor: default; }
     .adderr { font-family: var(--sans); font-size: 11px; color: #c0392b; line-height: 1.3; }
   </style>
   ```

4. - [ ] Run the UI test; expect pass:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run src/tests/EngineList.test.ts
   ```
   Expected: `✓ src/tests/EngineList.test.ts (7)` … `Test Files 1 passed`.

5. - [ ] Wire it into `EngineSettings`. In `frontend/src/components/EngineSettings.svelte`, change the script import block (lines ~3-7) to drop `ENGINES` and import the component:
   ```svelte
     import RangeSlider from './RangeSlider.svelte';
     import EngineList from './EngineList.svelte';
     import {
       MEMORY_MB, SEARCH_TIMES,
       DEFAULT_LINES, DEFAULT_SEARCH_INDEX, DEFAULT_THREADS, DEFAULT_MEMORY_INDEX,
     } from '../lib/options';
     import type { Command } from '../lib/types';
   ```

6. - [ ] Replace the engine `<select>` row in `frontend/src/components/EngineSettings.svelte` (the `<div class="set-row">` … `<select>` … `</div>` block, lines ~21-28) with:
   ```svelte
   <div class="set-col">
     <span class="k">Engine</span>
     <EngineList {engineId} {onSetEngine} />
   </div>
   ```

7. - [ ] Add the column layout + drop the now-unused `.sel` rule. In `frontend/src/components/EngineSettings.svelte`'s `<style>` block, replace the `.set-row .sel { … }` rule with a `.set-col` rule:
   ```css
     .set-col { display: flex; flex-direction: column; gap: 8px; }
   ```
   (Leave `.set-row` and `.set-row .k` as-is; `.k` styles the label in both layouts.)

8. - [ ] Trim the `EngineSettings` test — the `<select>` is gone (engine selection is covered by `EngineList.test.ts`). In `frontend/src/tests/EngineSettings.test.ts`, delete the second test (`it('changing the engine select calls onSetEngine', …)`, lines ~19-26) entirely, keeping the sliders test.

9. - [ ] Retire the unused `options.ts` engine exports. In `frontend/src/lib/options.ts`, delete the last three lines:
   ```ts
   export interface EngineOption { id: string; label: string; }
   export const ENGINES: EngineOption[] = [
     { id: 'stockfish', label: 'Stockfish' },
     { id: 'stockfish_lite', label: 'Stockfish Lite' },
   ];
   export const engineLabel = (id: string) => ENGINES.find((e) => e.id === id)?.label ?? id;
   ```
   (Keep everything above: `SearchTime`, `SEARCH_TIMES`, `MEMORY_MB`, `DEFAULT_*`, `searchLabel`, `memoryLabel`.)

10. - [ ] Gate — type-check (catches any dangling `ENGINES`/`engineLabel` import and Svelte a11y warnings):
    ```bash
    cd /home/buga/Dev/ChessMenthol/frontend && npm run check
    ```
    Expected: `svelte-check found 0 errors and 0 warnings`. If a Svelte a11y warning appears on a button in `EngineList.svelte`, add the precise `<!-- svelte-ignore <rule_name> -->` comment immediately above the element (mirroring `EngineHeader.svelte`) and re-run — do not leave any warning.

11. - [ ] Gate — full vitest:
    ```bash
    cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run
    ```
    Expected: all test files pass (`0 failed`), including `EngineSettings.test.ts`, `EngineHeader.test.ts`, `smoke.test.ts` (App renders the new `EngineList` under jsdom with `isTauri() === false`, so no add button and no dialog import call).

12. - [ ] Commit:
    ```bash
    cd /home/buga/Dev/ChessMenthol && git add -A && git commit -m "$(cat <<'EOF'
    feat(engine): EngineList picker with bring-your-own add/remove

    Replaces the engine <select> with a registry-backed radio list: select,
    remove external engines, and "+ Add engine" (native file picker →
    engine_validate → add + select). Retires options.ts engine exports.

    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
    EOF
    )"
    ```

---

## Task 10 — Full gate sweep

**Files:** none (verification only)

### Steps

1. - [ ] Frontend tests:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npx vitest run
   ```
   Expected: `Test Files … passed` with `0 failed`.

2. - [ ] Frontend type/lint gate:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && npm run check
   ```
   Expected: `svelte-check found 0 errors and 0 warnings` and `tsc -p tsconfig.node.json` clean.

3. - [ ] Rust build + tests:
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend/src-tauri && cargo build && cargo test
   ```
   Expected: `Finished` and `test result: ok. 4 passed; 0 failed`.

4. - [ ] If all green, no commit needed (no changes). If a gate surfaced a fix, commit it with an appropriate `fix(engine): …` message + the standard trailer.

---

## Task 11 — Manual e2e (human gate)

**Files:** none (manual verification)

> Requires a real desktop session and a second UCI engine binary on disk (e.g. a downloaded `lc0`, `komodo`, or a second `stockfish`). Run on the dev Linux box.

### Steps

1. - [ ] Launch the desktop app (WebKitGTK DMABUF workaround per the project memory):
   ```bash
   cd /home/buga/Dev/ChessMenthol/frontend && WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
   ```

2. - [ ] Open the engine settings (cog). Confirm the engine list shows **Stockfish 18** (selected, no remove control) and a **"+ Add engine"** action.

3. - [ ] Click "+ Add engine"; in the native file picker choose a real UCI engine binary. Confirm a brief *validating…* state, then the engine appears (with its reported name + muted path) and is **selected**.

4. - [ ] Enable Analysis. Confirm evaluations/lines stream from the newly-selected external engine (depth advances; the header tag shows the new engine name).

5. - [ ] Switch back to **Stockfish 18**; confirm analysis re-streams from the bundled engine.

6. - [ ] Select the external engine again, then click its `✕`. Confirm it is removed and the selection **falls back to Stockfish 18**, with analysis still streaming.

7. - [ ] Add-failure check: "+ Add engine" → pick a non-engine file (e.g. a text file or `/bin/cat`). Confirm an inline error ("… isn't a working UCI engine"), nothing is added, and the previously-selected engine keeps running.

8. - [ ] Restart the app; confirm the previously-added external engine persists in the list (localStorage hydrate) and the bundled engine remains first/non-removable.

9. - [ ] Record the result in the migration memory note and mark this gate passed.

---

## Self-review / coverage

| Spec section | Covered by |
|---|---|
| §3.1 `engineRegistry.ts` (record shape, localStorage `chessmenthol.engines`, bundled synthesized & non-removable, `list/add/remove/get`) | Task 6 (+ `engineName` helper) |
| §3.1 `engineController` generalization (registry lookup drives identity; bundled→sidecar/wasm, external→path; Threads/Hash from `configure()`) | Task 7 |
| §3.1 `nativeEngine.loadNativeEngine` takes the record (kind+path) | Task 5 |
| §3.2 `engine_start` generalized (bundled sidecar | external path; lifecycle reused) | Task 2 |
| §3.2 `engine_validate(path) -> {name} | err` | Task 3 |
| §3.3 Tauri dialog plugin + JS package + capability | Task 1 |
| §3.4 Tauri-only add/external; browser shows bundled only, no add button | Task 9 (`canAdd = isTauri()`), Task 7 (browser falls back to `loadStockfish`) |
| §4 Add flow (dialog → validate → add + select) | Task 9 (`addEngine`) |
| §4 Select flow (`set_engine` → `select` → `engine_start{kind,path}`) | Tasks 7 + 2 (orchestrator `setEngine` unchanged) |
| §4 Remove flow (drop record; selected → fall back to bundled) | Task 9 (`removeEngine`) + Task 7 (`recordFor` fallback) |
| §5 `EngineList` UI (radio, bundled first/no remove, external path + ✕, "+ Add", validating, inline error) | Task 9 |
| §6 Error handling (validation failure → message/nothing added; spawn failure → error frame + bundled fallback; remove-selected → bundled) | Task 9 + Task 7 (`recordFor` fallback) + orchestrator/LazySession `applyFrame('error')` (existing) |
| §7 Tests — registry; controller selection (bundled/external/reload); add flow success/failure; Rust validate happy + failure | Tasks 4, 6, 7, 9 |
| §7 Manual e2e | Task 11 |
| §8 Phasing (Rust → frontend core → UI → tests/e2e) | Task order 1-4 → 5-8 → 9 → 10-11 |

### Verification points (flag to the controller — written as most-likely-correct, confirm during impl)
- **Dialog JS `open` return shape:** `@tauri-apps/plugin-dialog` `open({ multiple:false, directory:false })` returns `Promise<string | null>` in 2.7.x (the code defensively narrows with `typeof picked === 'string'`). Confirmed against the plugin guest-js docs; if a future version returns an object, adjust the narrowing in `EngineList.svelte`.
- **External spawn API:** `app.shell().command(path)` (verified present in `tauri-plugin-shell-2.3.5/src/lib.rs:59`, returns `Command` with `.spawn()`/`.current_dir()`); Rust-side spawn is not gated by the JS shell ACL (intentional, per spec §3.2). Confirmed.
- **`engine_validate` uses `std::process::Command`** (synchronous, mirrors `lib.rs`'s Wayland CLI capture) rather than the shell plugin's async `Receiver`, so the command is sync and unit-testable without an async runtime. The 10s timeout is enforced via a worker thread + `mpsc::recv_timeout`.

### Phase 3 follow-ups (out of scope here)
- Curated one-click engine downloads: download manager + per-OS binary catalog + checksums + (de)quarantine on macOS (spec §8/§9). Would add a curated source alongside BYO in `engineRegistry`/`EngineList`.
- Per-engine UCI options panel (parse each engine's `option name …` lines into a form) — explicitly YAGNI for this phase (spec §9).
- Proactive "missing binary" detection/greyed state — deferred; current behavior surfaces a spawn error + falls back to bundled (spec §5/§9).
- Optional polish: seed sensible default Threads/Hash for first analysis (this plan, per spec, lets Threads/Hash come only from the global controls, so a fresh engine starts at its own defaults until the user moves a slider).
