# Android Foundation + Native Stockfish Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an Android build of ChessMenthol whose shared Svelte frontend runs in the WebView and can analyze a chess position with a **native Stockfish** compiled for Android, spawned from the app's `nativeLibraryDir`.

**Architecture:** One codebase, add a Tauri 2 Android target. Desktop-only Rust (screen capture, sidecar engine, `xcap`) is gated behind `#[cfg(desktop)]`; a new Kotlin **mobile plugin** spawns `libstockfish.so` as a child process and streams its UCI stdout to the WebView. The TypeScript `UciEngine` seam gains a `platform()` dispatch so desktop keeps its existing native path unchanged and Android routes to the plugin.

**Tech Stack:** Tauri 2 (mobile), Rust, Kotlin (Android plugin), Android NDK (cross-compiling Stockfish), Svelte 5 + TypeScript, Vitest.

---

## Implementation status (2026-07-04)

Host-verifiable slices **DONE** on branch `worktree-android-apk` (636 tests, check 0/0, host `cargo check` green):
- **Task 1** — desktop Rust cfg-gated (commit `432727f`).
- **Task 6** — JS engine dispatch + `lib/platform.ts` + tests (commit `674511c`).
- **Task 7** — mobile engine UI hide + defaults + test (commit `5d62d5a`).

**Two corrections applied vs. the text below** (do NOT re-do these in the device tasks):
1. `tauri-plugin-os` was added to the **all-platform** `[dependencies]` (not mobile-only) and registered unconditionally, plus `os:allow-platform` in `capabilities/default.json` — because the desktop `loadEngine` calls `platform()` at runtime too. **Already done.**
2. `lib/platform.ts` (`isMobile()`) was created in Task 6 (the plan text put it in Task 7); Task 7's remaining work was only the UI hide + engine defaults. **Already done.**

**Still TODO (device/NDK — your Android machine):** Task 2 (bootstrap), Task 3 (build `libstockfish.so`), Task 4 (exec spike — the make-or-break), Task 5 (Kotlin plugin + its **mobile-only** `tauri-plugin-engine` path dep — that one line is what was deferred out of Task 6), Task 8 (on-device smoke). Note: the sidecar for host `cargo check` is provisioned by `node scripts/fetch-sidecar.mjs` (gitignored).

---

## Scope of THIS plan (Plan 1 of 2)

**In:** Rust platform-gating, Android target bootstrap, cross-compiling Stockfish, the `.so`-exec spike (the gating risk), the Kotlin engine plugin, the JS engine dispatch, mobile engine defaults, and an on-device end-to-end analysis smoke.

**Out (Plan 2):** Camera capture (`getUserMedia` + `CameraOverlay`), perspective correction (`vision/warp.ts`), and the MVP capture→analyze flow. Until Plan 2, the Android build analyzes a **hardcoded FEN** to prove the engine path.

## Environment reality (read before executing)

Several tasks **cannot be verified in the planning environment** — they need an Android SDK + NDK and a physical device or emulator. Each such step is marked **[DEVICE]** (verified on-device by a human) or **[NDK]** (needs the Android NDK toolchain). Steps marked **[HERE]** are verifiable on any dev machine (Vitest/host `cargo check`). Do not mark a **[DEVICE]**/**[NDK]** step complete from a green host build alone.

**Prerequisites to install once (document versions actually used):**
- Android Studio + SDK (platform-tools, an SDK platform e.g. API 34, build-tools) and the **NDK** (e.g. r26+).
- Env: `ANDROID_HOME` (SDK path) and `NDK_HOME` (NDK path) exported.
- A JDK 17.
- Rust Android target for arm64: `rustup target add aarch64-linux-android`.
- A device with USB debugging, or an arm64 emulator (`x86_64` emulators can't run an arm64 `.so`; use an `arm64-v8a` system image or a real device).

---

## Task 1: Gate desktop-only Rust so the Android target can compile

`xcap` (screen capture) and `tauri-plugin-shell` (sidecar) do not build for Android. Move them to desktop-only target dependencies and `#[cfg(desktop)]`-gate the code that uses them, so the mobile build compiles.

**Files:**
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/src/engine.rs` (module gate only)

- [ ] **Step 1: Make `xcap`, `image`, and the shell plugin desktop-only in Cargo.toml**

Replace the flat `[dependencies]` block's desktop-only crates with a target-gated block. Keep `tauri`, `serde`, and `tauri-plugin-dialog` (dialog is used by the external-engine picker — desktop-only feature, but the crate itself builds on mobile; still, gate it too since we don't use it on mobile). Final `Cargo.toml` dependencies section:

```toml
[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }

# Desktop-only: screen capture (xcap) + PNG decode + the sidecar/dialog plugins.
# None of these are used on (or, for xcap, buildable for) Android/iOS.
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
xcap = "0.9"
image = { version = "0.25", default-features = false, features = ["png"] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Gate the engine + capture modules and their registration in `lib.rs`**

Guard the desktop `capture_frame`, the `engine` module, and the desktop plugins/handlers behind `#[cfg(desktop)]`. The mobile branch registers no capture/engine yet (the Kotlin engine plugin arrives in Task 5). Rewrite the top of `lib.rs` so the `mod engine;` and the desktop imports are desktop-only, and split the builder registration:

```rust
#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
mod engine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(engine::EngineState::default())
        .invoke_handler(tauri::generate_handler![
            capture_frame,
            engine::engine_start,
            engine::engine_send,
            engine::engine_stop,
            engine::engine_probe
        ]);

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = _event {
                if let Some(child) =
                    _app.state::<engine::EngineState>().0.lock().unwrap().take()
                {
                    let _ = child.kill();
                }
            }
        });
}
```

Then wrap the existing `capture_frame` command and its Wayland/xcap helpers (everything from `#[tauri::command] fn capture_frame` to the end of `which`) in a `#[cfg(desktop)]` module or prefix each `fn` with `#[cfg(desktop)]`. Simplest: add this above `#[tauri::command]\nfn capture_frame`:

```rust
#[cfg(desktop)]
// (capture_frame + is_wayland + capture_xcap + capture_wayland_cli + which stay as-is below)
```

and mark each of those five `fn`s `#[cfg(desktop)]`. Also add `#![allow(unused)]`-free gating: since `use xcap::Monitor;` and `use std::process::Command;` are only used by desktop code, move those `use` lines to be `#[cfg(desktop)]` too.

- [ ] **Step 3: Gate the whole `engine.rs` body (belt-and-suspenders)**

`engine.rs` uses `tauri_plugin_shell`, which is desktop-only now. It is already only `mod engine;`-included under `#[cfg(desktop)]` (Step 2), so no per-item gating is needed inside it. Add a file-top comment recording that:

```rust
//! Desktop-only. Included via `#[cfg(desktop)] mod engine;` in lib.rs. Android uses
//! the Kotlin `engine` plugin (see src-tauri/../tauri-plugin-engine) instead.
```

- [ ] **Step 4: Verify the host (desktop) build still compiles — [HERE]**

Run: `cd app/src-tauri && cargo check`
Expected: PASS (Linux is `desktop`, so all desktop deps/code still compile exactly as before). 0 new warnings about unused `xcap`/`Command`.

- [ ] **Step 5: Verify the TS suite is untouched — [HERE]**

Run: `cd app && npm test`
Expected: PASS — the full existing suite (~580 cases), unchanged (no TS touched yet).

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/Cargo.toml app/src-tauri/src/lib.rs app/src-tauri/src/engine.rs
git commit -m "build(android): gate desktop-only Rust (xcap, shell, capture) behind cfg(desktop)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Bootstrap the Android target

Generate the Gradle project, commit it, and confirm the shared frontend loads in the Android WebView.

**Files:**
- Create (generated): `app/src-tauri/gen/android/**`
- Possibly create: `app/src-tauri/tauri.android.conf.json` (only if a config override is needed)

- [ ] **Step 1: Add the Android target — [NDK]**

Run (from `app/`): `npm run tauri android init`
Expected: creates `src-tauri/gen/android/` (a Gradle project). If it prompts, supply the app identifier already in `tauri.conf.json` (`app.chessmenthol`).
Confirm `$ANDROID_HOME` and `$NDK_HOME` are set first, or init errors with a missing-SDK/NDK message.

- [ ] **Step 2: Commit the generated Android project**

Tauri recommends committing `gen/android`. Ensure it is not gitignored (the repo ignores `docs/superpowers`, not `gen/`), then:

```bash
git add app/src-tauri/gen/android
git commit -m "build(android): scaffold Android target via tauri android init

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Run the app on a device/emulator — [DEVICE]**

Run: `npm run tauri android dev` (add `--open` to drive it from Android Studio; use `--host` if the device can't reach the dev server on localhost).
Expected: the app installs and launches; the **Home screen renders** in the WebView (same UI as desktop, in the narrow single-column layout since a phone is < 819.98px).

- [ ] **Step 4: Confirm the vision worker / ORT loads (cross-origin isolation, risk #1) — [DEVICE]**

While in `android dev`, open the app to a screen that touches the vision worker (or add a temporary `console.log(crossOriginIsolated)` in the worker bootstrap). Check `chrome://inspect` (remote-debug the WebView) console.
Expected: no `SharedArrayBuffer is not defined` crash. If `crossOriginIsolated` is `false`, the COOP/COEP headers aren't applied on the Android scheme — record it and rely on `onnxruntime-web`'s single-threaded fallback (this is a Plan-2 concern for vision; the engine path here does not need SAB). Note the finding in the task checkbox.

- [ ] **Step 5: Commit any config override needed**

If Step 3/4 required a `tauri.android.conf.json` (e.g. to set headers or min-SDK), commit it:

```bash
git add app/src-tauri/tauri.android.conf.json
git commit -m "build(android): android config overrides for dev run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Cross-compile Stockfish for arm64 as `libstockfish.so`

Build Stockfish with the NDK (arm64-v8a, default NNUE net embedded), name it `lib*.so` so Android extracts it into `nativeLibraryDir`, and force native-lib extraction.

**Files:**
- Create: `app/src-tauri/scripts/build-stockfish-android.sh`
- Create (build output, committed): `app/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libstockfish.so`
- Modify: `app/src-tauri/gen/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Write the build script**

Create `app/src-tauri/scripts/build-stockfish-android.sh`:

```bash
#!/usr/bin/env bash
# Cross-compile Stockfish for Android arm64-v8a and install it as libstockfish.so
# into the app's jniLibs (the only place Android lets us execute a bundled binary).
# Requires: NDK_HOME, network access (the default NNUE net is downloaded + embedded),
# make, git. Pin SF_TAG to a known release.
set -euo pipefail

SF_TAG="${SF_TAG:-sf_17}"                    # pin a Stockfish release tag
API="${ANDROID_API:-24}"                     # minSdk for the toolchain
HOST_TAG="linux-x86_64"                       # NDK prebuilt host
ROOT="$(cd "$(dirname "$0")/.." && pwd)"      # app/src-tauri
OUT="$ROOT/gen/android/app/src/main/jniLibs/arm64-v8a"
WORK="$(mktemp -d)"

: "${NDK_HOME:?set NDK_HOME to your Android NDK path}"
TOOLCHAIN="$NDK_HOME/toolchains/llvm/prebuilt/$HOST_TAG/bin"
export CXX="$TOOLCHAIN/aarch64-linux-android${API}-clang++"

git clone --depth 1 --branch "$SF_TAG" https://github.com/official-stockfish/Stockfish.git "$WORK/sf"
cd "$WORK/sf/src"

# Plain `build` (NOT profile-build: PGO would try to RUN the arm64 binary on the host).
# Static libc++ so the binary has no runtime dependency on libc++_shared.so.
make -j"$(nproc)" build ARCH=armv8 COMP=clang CXX="$CXX" \
  EXTRALDFLAGS="-static-libstdc++ -static-libgcc"

mkdir -p "$OUT"
cp stockfish "$OUT/libstockfish.so"
cd "$ROOT"; rm -rf "$WORK"

echo "Installed: $OUT/libstockfish.so"
file "$OUT/libstockfish.so"
```

- [ ] **Step 2: Run the build — [NDK]**

Run: `chmod +x app/src-tauri/scripts/build-stockfish-android.sh && NDK_HOME=$NDK_HOME app/src-tauri/scripts/build-stockfish-android.sh`
Expected final line from `file`: `ELF 64-bit LSB pie executable, ARM aarch64, ... dynamically linked` (PIE + aarch64). If it says `x86-64`, `$CXX` wasn't the NDK arm64 clang — fix and rerun.

- [ ] **Step 3: Force native-lib extraction so the `.so` is executable — [NDK]**

In `app/src-tauri/gen/android/app/src/main/AndroidManifest.xml`, add `android:extractNativeLibs="true"` to the `<application>` element:

```xml
<application
    android:extractNativeLibs="true"
    ... >
```

(Equivalent alternative, in `gen/android/app/build.gradle.kts`: `android { packaging { jniLibs { useLegacyPackaging = true } } }`.) Without this, modern Gradle leaves the `.so` un-extracted inside the APK, where it **cannot be exec'd** — the engine would fail to spawn.

- [ ] **Step 4: Commit the binary + manifest change**

```bash
git add app/src-tauri/scripts/build-stockfish-android.sh \
        app/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libstockfish.so \
        app/src-tauri/gen/android/app/src/main/AndroidManifest.xml
git commit -m "build(android): cross-compile Stockfish arm64 as libstockfish.so (embedded net)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Note (spec open question): the default embedded net makes the `.so` large (tens of MB). If APK size is a problem, rebuild with a smaller net (`make ... net` variants) and record the size/strength trade-off. arm64-v8a only for MVP; add `armeabi-v7a`/`x86_64` later by extending the script's `ARCH`/target and jniLibs dir.

---

## Task 4: Engine spike — prove exec-from-`nativeLibraryDir` answers UCI on-device

The cheapest possible proof of the gating risk (#2) before building the real plugin: spawn the `.so` once at startup and log whether it prints `uciok`. This is throwaway — it is replaced by the real plugin in Task 5.

**Files:**
- Modify (temporarily): `app/src-tauri/gen/android/app/src/main/java/.../MainActivity` (or the generated activity) — a one-shot spike in `onCreate`.

- [ ] **Step 1: Add a one-shot spawn-and-log spike — [DEVICE]**

In the generated Android activity (path under `gen/android/app/src/main/java/app/chessmenthol/`), add to `onCreate` (after `super.onCreate`):

```kotlin
Thread {
  try {
    val dir = applicationInfo.nativeLibraryDir
    val proc = ProcessBuilder("$dir/libstockfish.so")
      .redirectErrorStream(true).start()
    proc.outputStream.write("uci\nisready\nquit\n".toByteArray())
    proc.outputStream.flush()
    val out = proc.inputStream.bufferedReader().readText()
    android.util.Log.i("SF_SPIKE", "sawUciok=${out.contains("uciok")} sawReadyok=${out.contains("readyok")}")
    android.util.Log.i("SF_SPIKE", out.take(400))
  } catch (e: Exception) {
    android.util.Log.e("SF_SPIKE", "spawn failed", e)
  }
}.start()
```

- [ ] **Step 2: Run and read logcat — [DEVICE]**

Run: `npm run tauri android dev` then `adb logcat -s SF_SPIKE`
Expected: `sawUciok=true sawReadyok=true`. This is **the make-or-break signal**: it proves a bundled binary executes from `nativeLibraryDir` and speaks UCI on the target device.
If it fails with `Permission denied`/`text file busy`/`ENOEXEC`: recheck Task 3 Step 2 (arm64 PIE) and Step 3 (extractNativeLibs). Do not proceed to Task 5 until this is green.

- [ ] **Step 3: Remove the spike and commit the removal**

Delete the `onCreate` spike block (the plugin replaces it).

```bash
git add -A && git commit -m "chore(android): remove engine spike after proving .so exec speaks UCI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Kotlin `engine` plugin — start / send / stop with line streaming

Productionize the spike into a Tauri mobile plugin that owns one Stockfish process, writes UCI to its stdin, and streams stdout lines to the WebView as plugin events.

**Files:**
- Create: a local Tauri plugin (scaffolded), e.g. `app/src-tauri/plugins/tauri-plugin-engine/` with:
  - `android/src/main/java/.../EnginePlugin.kt`
  - `src/lib.rs`, `src/mobile.rs`, `src/commands.rs`, `permissions/…`, `build.rs`, `Cargo.toml`
- Modify: `app/src-tauri/Cargo.toml` (add the plugin as a mobile-only path dep)
- Modify: `app/src-tauri/src/lib.rs` (register the plugin under `#[cfg(mobile)]`)

- [ ] **Step 1: Scaffold the plugin**

Run (from `app/src-tauri/`): `npx tauri plugin new engine --android --no-api`
(Confirm current flags with `npx tauri plugin new --help`; the intent is: a plugin named `engine` with Android Kotlin support and no separate JS API package — we call it via `invoke('plugin:engine|…')` directly.)
Move/keep it at `app/src-tauri/plugins/tauri-plugin-engine/`.

- [ ] **Step 2: Write the Kotlin plugin**

`plugins/tauri-plugin-engine/android/src/main/java/.../EnginePlugin.kt`:

```kotlin
package app.chessmenthol.engine

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import java.io.BufferedReader
import java.io.InputStreamReader

@TauriPlugin
class EnginePlugin(private val activity: Activity) : Plugin(activity) {
    private var proc: Process? = null
    private var reader: Thread? = null

    @Command
    fun start(invoke: Invoke) {
        stopProcess()
        try {
            val dir = activity.applicationInfo.nativeLibraryDir
            val p = ProcessBuilder("$dir/libstockfish.so")
                .redirectErrorStream(true)
                .start()
            proc = p
            reader = Thread {
                val br = BufferedReader(InputStreamReader(p.inputStream))
                try {
                    while (true) {
                        val line = br.readLine() ?: break
                        val ev = JSObject()
                        ev.put("line", line)
                        trigger("line", ev)   // -> addPluginListener('engine','line', ...)
                    }
                } catch (_: Exception) { /* process ended */ }
            }.also { it.isDaemon = true; it.start() }
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("engine start failed: ${e.message}")
        }
    }

    @Command
    fun send(invoke: Invoke) {
        val line = invoke.getString("line") ?: ""
        val p = proc
        if (p == null) { invoke.reject("no engine running"); return }
        try {
            p.outputStream.write((line + "\n").toByteArray())
            p.outputStream.flush()
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("engine send failed: ${e.message}")
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        stopProcess()
        invoke.resolve()
    }

    private fun stopProcess() {
        try { proc?.destroy() } catch (_: Exception) {}
        proc = null
        reader = null
    }

    override fun onPause() { stopProcess() }   // don't leave an orphan when backgrounded
}
```

- [ ] **Step 3: Wire the Rust plugin commands**

In `plugins/tauri-plugin-engine/src/mobile.rs` / `commands.rs`, define `start`/`send`/`stop` commands that forward to the Android plugin handle (the scaffold generates the `run_mobile_plugin` pattern). `commands.rs`:

```rust
use tauri::{command, AppHandle, Runtime};
use crate::EngineExt;

#[command]
pub(crate) async fn start<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.engine().start().map_err(|e| e.to_string())
}

#[command]
pub(crate) async fn send<R: Runtime>(app: AppHandle<R>, line: String) -> Result<(), String> {
    app.engine().send(line).map_err(|e| e.to_string())
}

#[command]
pub(crate) async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.engine().stop().map_err(|e| e.to_string())
}
```

Follow the scaffold's `mobile.rs` `run_mobile_plugin("start"|"send"|"stop", ...)` calls into the Kotlin `@Command`s, and register the three commands in the plugin's `Builder::new("engine").invoke_handler(tauri::generate_handler![commands::start, commands::send, commands::stop])`. Grant them in `permissions/default.toml`.

- [ ] **Step 4: Add the plugin as a mobile-only dependency and register it**

`app/src-tauri/Cargo.toml`:

```toml
[target.'cfg(any(target_os = "android", target_os = "ios"))'.dependencies]
tauri-plugin-engine = { path = "plugins/tauri-plugin-engine" }
```

`app/src-tauri/src/lib.rs` — register under mobile in the builder split from Task 1:

```rust
    let builder = tauri::Builder::default();

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_engine::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        // ...unchanged desktop registration from Task 1...
```

- [ ] **Step 5: Build and confirm the plugin loads — [DEVICE]**

Run: `npm run tauri android dev`
Expected: app builds and launches with no Kotlin/Gradle errors; the `engine` plugin is registered (JS will exercise it in Task 6/8). If Gradle can't find the plugin's Android code, confirm the scaffold added the plugin to `gen/android/…/tauri.settings.gradle` include list.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/plugins/tauri-plugin-engine app/src-tauri/Cargo.toml app/src-tauri/src/lib.rs
git commit -m "feat(android): Kotlin engine plugin spawning libstockfish.so with line streaming

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: JS engine dispatch — route Android to the plugin (TDD)

Add `platform()` detection and a `loadAndroidEngine` that talks to the `engine` plugin, sharing the existing UCI handshake with `loadNativeEngine`. This is the one fully **[HERE]**-testable task.

**Files:**
- Modify: `app/package.json` (add `@tauri-apps/plugin-os`)
- Modify: `app/src/engine/nativeEngine.ts` (extract shared handshake; add `loadAndroidEngine`; add `loadEngine` dispatcher)
- Modify: `app/src/lib/engineClient.ts:78` (call `loadEngine`)
- Test: `app/src/tests/androidEngine.test.ts` (new)

- [ ] **Step 1: Add the OS plugin dependency**

Run (from `app/`): `npm i @tauri-apps/plugin-os` and add the Rust side for mobile only in `app/src-tauri/Cargo.toml`:

```toml
[target.'cfg(any(target_os = "android", target_os = "ios"))'.dependencies]
tauri-plugin-os = "2"
tauri-plugin-engine = { path = "plugins/tauri-plugin-engine" }   # (from Task 5)
```

Register it under `#[cfg(mobile)]` in `lib.rs` alongside the engine plugin: `.plugin(tauri_plugin_os::init())`.

- [ ] **Step 2: Write the failing test**

`app/src/tests/androidEngine.test.ts` (mirrors the `vi.hoisted` mock style of `nativeEngine.test.ts`, but mocks `platform`, `invoke`, and `addPluginListener`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, listeners, platformMock } = vi.hoisted(() => {
  const invokeMock = vi.fn(async (..._a: unknown[]) => {});
  const listeners: Record<string, (p: { line: string }) => void> = {};
  const platformMock = vi.fn(() => 'android');
  return { invokeMock, listeners, platformMock };
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
  Channel: class { onmessage: ((m: string) => void) | null = null; },
  addPluginListener: async (_plugin: string, event: string, cb: (p: { line: string }) => void) => {
    listeners[event] = cb;
    return { unregister: async () => {} };
  },
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => platformMock() }));

import { loadEngine } from '../engine/nativeEngine';

beforeEach(() => { invokeMock.mockClear(); platformMock.mockReturnValue('android'); });

function fireLine(line: string) { listeners['line']?.({ line }); }

describe('loadEngine on Android', () => {
  it('starts via the engine plugin and resolves on uciok', async () => {
    // engine.send('uci') -> we answer uciok on the listener channel.
    invokeMock.mockImplementation(async (cmd: string, args?: { line?: string }) => {
      if (cmd === 'plugin:engine|send' && args?.line === 'uci') queueMicrotask(() => fireLine('uciok'));
    });
    const engine = await loadEngine({ kind: 'bundled' });
    expect(invokeMock).toHaveBeenCalledWith('plugin:engine|start');

    const lines: string[] = [];
    engine.onLine((l) => lines.push(l));
    fireLine('info depth 1 score cp 20');
    fireLine('bestmove e2e4');
    expect(lines).toEqual(['info depth 1 score cp 20', 'bestmove e2e4']);
  });

  it('send() forwards a UCI line via the plugin', async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: { line?: string }) => {
      if (cmd === 'plugin:engine|send' && args?.line === 'uci') queueMicrotask(() => fireLine('uciok'));
    });
    const engine = await loadEngine({ kind: 'bundled' });
    invokeMock.mockClear();
    engine.send('go movetime 1000');
    expect(invokeMock).toHaveBeenCalledWith('plugin:engine|send', { line: 'go movetime 1000' });
  });

  it('delegates to the desktop native path when platform is not mobile', async () => {
    platformMock.mockReturnValue('linux');
    invokeMock.mockImplementation(async (cmd: string, args?: { onLine?: { onmessage?: (m: string) => void } }) => {
      if (cmd === 'engine_start') queueMicrotask(() => args?.onLine?.onmessage?.('uciok'));
    });
    await loadEngine({ kind: 'bundled' });
    expect(invokeMock).toHaveBeenCalledWith('engine_start', expect.objectContaining({ spec: { kind: 'bundled' } }));
    expect(invokeMock).not.toHaveBeenCalledWith('plugin:engine|start');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails — [HERE]**

Run: `cd app && npx vitest run src/tests/androidEngine.test.ts`
Expected: FAIL — `loadEngine` is not exported from `nativeEngine.ts`.

- [ ] **Step 4: Implement `loadEngine` + `loadAndroidEngine` and extract the shared handshake**

In `app/src/engine/nativeEngine.ts`: (a) extract the handshake into a helper, (b) add the Android loader, (c) add the dispatcher. Add these imports and code (keep the existing `loadNativeEngine`, refactored to call the shared helper):

```ts
import { invoke, Channel, addPluginListener } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import type { UciEngine } from './engine';
import { parseOptions } from './uciOptions';

/** Shared UCI handshake: send `uci`, resolve on `uciok`, capture option lines. */
async function handshake(engine: UciEngine, timeoutMs: number): Promise<void> {
  const optionLines: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      engine.dispose();
      reject(new Error(`native engine failed to initialize within ${timeoutMs}ms`));
    }, timeoutMs);
    engine.onLine((line: string) => {
      if (line.startsWith('option name ')) optionLines.push(line);
      else if (line === 'uciok') { clearTimeout(timer); resolve(); }
    });
    engine.send('uci');
  });
  engine.options = parseOptions(optionLines);
}

/** True on Tauri mobile (Android/iOS). */
function isMobile(): boolean {
  const p = platform();
  return p === 'android' || p === 'ios';
}

/** Android/iOS UciEngine backed by the Kotlin `engine` plugin (spec is always bundled). */
export async function loadAndroidEngine(_spec: EngineSpec, timeoutMs = 10_000): Promise<UciEngine> {
  let listener: ((line: string) => void) | null = null;
  const lineBuffer: string[] = [];
  const pushLine = (line: string) => {
    const t = line.trim();
    if (!t) return;
    if (listener) listener(t); else lineBuffer.push(t);
  };
  const sub = await addPluginListener('engine', 'line', (p: { line: string }) => pushLine(p.line));

  await invoke('plugin:engine|start');

  const engine: UciEngine = {
    send: (cmd: string) => { invoke('plugin:engine|send', { line: cmd }).catch(() => {}); },
    onLine: (cb: (line: string) => void) => {
      listener = cb;
      for (const line of lineBuffer) cb(line);
      lineBuffer.length = 0;
    },
    dispose: () => { invoke('plugin:engine|stop').catch(() => {}); sub.unregister().catch(() => {}); },
  };

  await handshake(engine, timeoutMs);
  return engine;
}

/** Platform dispatcher: Android/iOS -> plugin; desktop -> native sidecar process. */
export function loadEngine(spec: EngineSpec, timeoutMs = 10_000): Promise<UciEngine> {
  return isMobile() ? loadAndroidEngine(spec, timeoutMs) : loadNativeEngine(spec, timeoutMs);
}
```

Then refactor the existing `loadNativeEngine` to call `await handshake(engine, timeoutMs)` instead of its inline handshake block (delete lines 44–57 of the current file and replace with `await handshake(engine, timeoutMs);`).

- [ ] **Step 5: Point `engineClient.ts` at the dispatcher**

In `app/src/lib/engineClient.ts`: change the import on line 17 from `loadNativeEngine` to `loadEngine`, and line 78 from `loadNativeEngine(` to `loadEngine(`. On Android the spec is always `{ kind: 'bundled' }` (no external picker), which the existing line-79 ternary already yields since mobile records have no `path`.

- [ ] **Step 6: Run the new test + full suite — [HERE]**

Run: `cd app && npx vitest run src/tests/androidEngine.test.ts && npm test`
Expected: the new test PASSES; the full suite (including the unchanged `nativeEngine.test.ts` and `engineClientNative.test.ts`) stays green. If `engineClientNative.test.ts` mocked `../engine/nativeEngine`'s `loadNativeEngine`, add a `loadEngine` export to that mock (it now delegates) — update the mock to also expose `loadEngine` forwarding to the same fake.

- [ ] **Step 7: Type-check — [HERE]**

Run: `cd app && npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 8: Commit**

```bash
git add app/package.json app/package-lock.json app/src/engine/nativeEngine.ts \
        app/src/lib/engineClient.ts app/src/tests/androidEngine.test.ts app/src-tauri/Cargo.toml app/src-tauri/src/lib.rs
git commit -m "feat(android): platform-dispatch the UCI engine (plugin on mobile, sidecar on desktop)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Mobile engine defaults + hide desktop-only engine UI (TDD where it applies)

On mobile, expose only the bundled engine, hide the add/external-engine UI, and apply conservative Threads/Hash.

**Files:**
- Create: `app/src/lib/platform.ts` (a tiny `isMobile()` helper for UI use)
- Modify: components that show the add-engine / external-engine picker (guard behind `!isMobile()`)
- Modify: `app/src/lib/engineClient.ts` (mobile default overrides for Threads/Hash on first load)
- Test: `app/src/tests/platform.test.ts` (new)

- [ ] **Step 1: Write the failing test for the platform helper**

`app/src/tests/platform.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'android' }));
import { isMobile } from '../lib/platform';

describe('isMobile', () => {
  it('is true on android', () => { expect(isMobile()).toBe(true); });
});
```

- [ ] **Step 2: Run to verify it fails — [HERE]**

Run: `cd app && npx vitest run src/tests/platform.test.ts`
Expected: FAIL — `../lib/platform` does not exist.

- [ ] **Step 3: Implement the helper**

`app/src/lib/platform.ts`:

```ts
import { platform } from '@tauri-apps/plugin-os';
import { isTauri } from '@tauri-apps/api/core';

/** True only inside a Tauri mobile (Android/iOS) shell. */
export function isMobile(): boolean {
  if (!isTauri()) return false;
  const p = platform();
  return p === 'android' || p === 'ios';
}
```

- [ ] **Step 4: Run to verify it passes — [HERE]**

Run: `cd app && npx vitest run src/tests/platform.test.ts`
Expected: PASS.

- [ ] **Step 5: Hide the add/external-engine UI on mobile**

In the engine-picker component (find it: `cd app && grep -rln "engineRegistry\|EngineList" src/components`), wrap the "+ Add engine" control and any external-engine rows with `{#if !isMobile()}…{/if}`, importing `isMobile` from `../lib/platform`. Keep the bundled engine always shown.

- [ ] **Step 6: Apply conservative mobile engine defaults**

In `app/src/lib/engineClient.ts`, where stored overrides are applied (`applyStored`, line ~67), seed mobile defaults when none are stored:

```ts
function applyStored(): void {
  if (!engine) return;
  const schema = getSchema(desiredId) ?? engine.options ?? [];
  const overrides = { ...getOverrides(desiredId) };
  if (isMobile()) {
    if (!('Threads' in overrides)) overrides['Threads'] = '2';
    if (!('Hash' in overrides)) overrides['Hash'] = '64';
  }
  applyOptions(engine, overrides, schema);
}
```

(Import `isMobile` from `./platform`.)

- [ ] **Step 7: Full suite + check — [HERE]**

Run: `cd app && npm test && npm run check`
Expected: all green, 0/0.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/platform.ts app/src/tests/platform.test.ts app/src/lib/engineClient.ts app/src/components
git commit -m "feat(android): mobile-only engine list + conservative Threads/Hash defaults

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: On-device end-to-end analysis smoke

Prove the whole engine path on real hardware with a hardcoded position (camera comes in Plan 2).

**Files:**
- Modify (temporary test affordance): a dev-only button or a default FEN so Analysis can run without capture.

- [ ] **Step 1: Give Analysis a position without capture — [DEVICE prep]**

Temporarily default the working board to the standard start position (or a known mid-game FEN) on Android, or add a hidden "Analyze start position" dev button on the Home screen behind `isMobile()`. This lets the engine run before Plan 2's camera exists.

- [ ] **Step 2: Run analysis on device — [DEVICE]**

Run: `npm run tauri android dev`, open the app, trigger analysis on the default position.
Expected: the Analysis screen streams a growing depth, an eval, and a best line; a bestmove appears. Confirm via `chrome://inspect` console / on-screen eval bar. This retires the engine half of risks #1 and #2 end-to-end.

- [ ] **Step 3: Sanity-check a release APK builds — [DEVICE/NDK]**

Run: `npm run tauri android build -- --apk -t aarch64`
Expected: produces an APK under `app/src-tauri/gen/android/app/build/outputs/apk/…`. Install it (`adb install <apk>`) and repeat Step 2 on the installed (non-dev) app to confirm the bundled `.so` path works in a packaged build (extraction/permissions differ from dev). Record the APK size (informs the net-size decision from Task 3).

- [ ] **Step 4: Commit the dev affordance (or revert if not wanted)**

```bash
git add -A && git commit -m "chore(android): dev affordance to analyze a default position (pre-camera)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done (Plan 1)

- `npm test` and `npm run check` green **[HERE]** (Tasks 1, 6, 7).
- Host `cargo check` green **[HERE]** (Task 1).
- On a real arm64 device **[DEVICE]**: the app launches, the engine plugin spawns `libstockfish.so`, and the Analysis screen streams eval + best line for a hardcoded position — in both `android dev` and an installed release APK.
- Desktop build and behavior unchanged (all desktop code still `#[cfg(desktop)]`, all existing tests pass).

## Self-review notes (author)

- **Spec coverage:** §5.1 (repo/target) → Task 2; §5.2 (platform detection) → Tasks 6–7; §5.3 (native `.so` engine, extractNativeLibs, Kotlin bridge, no external engine on mobile, mobile defaults) → Tasks 3–7; risk #2 spike (§8) → Task 4; risk #1 COOP/COEP (§8) → Task 2 Step 4; §9 sequencing steps 1–3 → this plan. §5.4/§5.5 (camera, warp) are intentionally Plan 2.
- **Placeholder scan:** the two "confirm current flags with `--help`" notes (Task 5 Step 1) and the "find the component with grep" (Task 7 Step 5) are genuine discovery steps with exact commands, not TODOs. NNUE-net-size is an explicit spec open question, not a gap.
- **Type consistency:** `loadEngine`/`loadAndroidEngine`/`loadNativeEngine` all return `Promise<UciEngine>`; `EngineSpec` reused verbatim; plugin commands `plugin:engine|start|send|stop` match between Kotlin (`@Command start/send/stop`) and JS; `isMobile()` defined once in `lib/platform.ts` for UI and locally in `nativeEngine.ts` for the loader (kept separate to avoid `nativeEngine.ts` importing UI helpers — noted intentionally).
