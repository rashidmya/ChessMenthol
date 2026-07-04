# ChessMenthol for Android (camera capture) — Design Spec

- **Date:** 2026-07-04
- **Status:** Approved design, pre-plan
- **Branch:** `worktree-android-apk`
- **Author:** brainstormed with the user (rashidmya)

## 1. Summary

Ship an Android APK build of ChessMenthol. The desktop app watches a chess board on
your **screen** (screen capture) and analyzes it with a native Stockfish process. The
Android build replaces screen capture with the **device camera**: the user photographs a
**screen that is displaying a chess.com or lichess board**, the app straightens that photo
into a clean board image, reads the position with the existing computer-vision pipeline,
and analyzes it with a **native Stockfish compiled for Android**.

This is one codebase, not a fork. Tauri 2's mobile support lets the entire Svelte/Vite
frontend, all of `core/`, all of `vision/`, and most of `components/` be shared. Only two
platform seams change behind existing guards, plus one genuinely new piece of vision work
(perspective correction).

## 2. Motivation & context

The current app (see `CLAUDE.md`) is desktop-only: a Svelte 5 + TypeScript renderer holds
the chess logic and vision (ONNX via `onnxruntime-web` in a Web Worker), and a thin Tauri 2
(Rust) shell does the two things a web page cannot — capture the screen (`capture_frame`)
and bridge to a native UCI engine process (`engine.rs` via `tauri-plugin-shell` sidecar).

Everyone with a phone can point a camera at a monitor. An Android build widens reach
dramatically without a second implementation of the chess/vision core.

## 3. Decisions (locked in during brainstorming)

| Question | Decision | Consequence |
|---|---|---|
| What is the camera pointed at? | A **screen** showing chess.com/lichess | Pieces remain the 2D digital renders the ONNX classifier already knows. **No model retraining.** The only new problem is *geometry*. |
| How does Stockfish run on Android? | **Native `.so`**, executed from the app's `nativeLibraryDir` | Desktop-grade strength; reuses the existing text-in/line-out `UciEngine` seam. Requires cross-compiling Stockfish with the NDK and an Android-specific spawn bridge. |
| How is a hand-held photo turned into a square board? | **Guided framing + automatic quad-warp**, with **manual four-corner tap** as fallback | New pure-TS perspective-correction module; the rest of the vision pipeline is unchanged. The Edit screen is the human backstop. |
| First-release scope | **MVP: snap → analyze** | No Report/Review, no screen-region capture, no bring-your-own external engine, no per-engine options panel (reduced to sane mobile defaults). |

## 4. Goals / non-goals

### Goals
- A sideloadable, release-signed **APK** (arm64-v8a) that runs on a modern Android phone.
- Core loop: **open camera → frame board → capture → straighten → read position → confirm/edit → native Stockfish streams eval + best lines + chess.com-style move classification.**
- Zero regression to the desktop build: desktop capture and engine paths untouched and all existing tests stay green.
- The new perspective-correction code is pure TypeScript and unit-tested (tests-as-spec convention).

### Non-goals (this release)
- Physical (3D) chess boards — out of scope; would need a different, purpose-trained model.
- Full-game **Report / Review** screens (they assume a desktop file/PGN workflow).
- Screen-region overlay capture, bring-your-own external UCI engines, the add-engine and per-engine UCI options UI.
- iOS. (Tauri makes it reachable later; not in scope now.)
- Google Play Store distribution (sideload APK only for now).
- Multi-ABI packaging beyond arm64-v8a (armeabi-v7a / x86_64 emulator support are a later add).

## 5. Architecture

### 5.1 One repo, added Android target

The `app/` project stays the single source. `tauri android init` generates a Gradle
project under `src-tauri/gen/android/`. The Svelte/Vite frontend, `core/`, `vision/`, and
most `components/` are shared verbatim. A significant free win: the desktop UI **already
reflows to a single mobile column below 819.98px** (`lib/viewport.ts` + the `@media`
blocks), so the phone layout largely already exists.

**Toolchain additions:** Android SDK + **NDK**, a JDK, and the Rust Android targets
(`aarch64-linux-android` for arm64-v8a; others deferred). New build steps stage the
cross-compiled Stockfish `.so` into `jniLibs/` (see §5.3).

### 5.2 Platform detection

The app already isolates platform work behind `isTauri()` / `hasNativeCapture()`
(`lib/capture.ts`, `lib/tauri.ts`). We add one axis: **is this Android?** via
`platform()` from `@tauri-apps/plugin-os` (returns `'android'`). Exactly three things
branch on it:

1. **Capture source** — camera vs screen (§5.4).
2. **Engine bridge** — Kotlin plugin vs Rust sidecar (§5.3).
3. **UI** — camera overlay replaces the screen-region overlay; Report/Review, add-engine,
   engine-options, and the desktop Titlebar are hidden.

Everything else — `core/orchestrator.ts`, `core/chess.ts`, classification, serialization,
the vision assembly (`detect → pieces → position → tracker`), the `send(Command)` / store
surface — is platform-agnostic and unchanged.

### 5.3 Seam A — Engine (native `.so` instead of a sidecar process)

**Problem.** On desktop, `engine.rs` spawns Stockfish via `tauri-plugin-shell`'s
sidecar / `externalBin`. Android sandboxes apps: since Android 10 the app's writable data
dir is mounted `noexec`, so a bundled binary can only be executed from the app's
**`nativeLibraryDir`**. The extraction path there is not stable, so it must be queried at
runtime. This is exactly the DroidFish / lichess-mobile technique.

**Build.** Cross-compile Stockfish with the NDK toolchain for `arm64-v8a`, and **embed
the default NNUE net at build time** (Stockfish supports an embedded net, avoiding any
CWD-relative or absolute-`EvalFile` path fragility on Android). Emit the binary named
**`libstockfish.so`** — the `lib*.so` name is required so Android's packager installs it
into `nativeLibraryDir` and marks it executable. Stage it into
`src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libstockfish.so`.

> ⚠️ **Critical Gradle detail:** set `android:extractNativeLibs=true`
> (`useLegacyPackaging=true`). The modern Gradle default (`false`) keeps native libs
> *un-extracted inside the APK*, where they **cannot be exec'd** — which would silently
> break the entire engine choice.

**Spawn bridge.** A small **Kotlin Tauri plugin** exposes `start` / `send` / `stop`:
- On `start`, resolve `context.applicationInfo.nativeLibraryDir + "/libstockfish.so"`,
  spawn it with `ProcessBuilder`, and stream its stdout lines back to the WebView over a
  Tauri channel — **the exact same newline-delimited UCI text protocol** the desktop
  bridge already speaks.
- On `send`, write a UCI line to the process's stdin.
- On `stop`, kill the process (and kill it on app pause/exit to avoid orphans).

The desktop Rust `engine.rs` is **left untouched**. `engine/nativeEngine.ts` gains a thin
`platform()` switch: Android → the Kotlin plugin commands; desktop → the existing Rust
commands. Both satisfy the same `UciEngine` (text-in / line-out) interface, so
`session.ts`, `uci.ts`, `uciOptions.ts`, and the orchestrator are unchanged.

**Engine registry on Android.** Single fixed engine = the bundled native Stockfish. No
`engine_probe`, no external-binary picker (`EngineSpec { kind:'external' }` is desktop-only).
`lib/engineRegistry.ts` presents just the one engine on mobile.

**Mobile defaults.** Conservative `Threads` (e.g. 2) and small `Hash` to avoid OOM /
thermal issues; movetime tuned for a phone. (Movetime is milliseconds throughout the TS,
per the `orchestrator.ts` header.)

### 5.4 Seam B — Capture (camera instead of screen)

**Problem.** `Capturer.grabFullDesktop()` (`lib/capture.ts`) calls the Rust `capture_frame`
command and decodes an RGBA buffer. On Android there is no screen to grab; the user
photographs an external screen.

**Design.** A new `CameraCapturer` uses **`getUserMedia`** inside the Chromium Android
WebView: a live `<video>` preview with a **square framing guide overlay**, capture a frame
to an offscreen `<canvas>`, read `ImageData` → the same `RgbaImage` shape
(`{ data, width, height }`) the pipeline already consumes. This is pure frontend — no new
Rust — and the live preview is what makes guided framing (§5.5) usable.

A new `CameraOverlay.svelte` component is the mobile analog of `RegionOverlay.svelte`
(which supplies the desktop capture UX + the Auto/White/Black board-side selector via
`set_board_side`). The board-side selector and orientation logic carry over unchanged.

Both capturers produce an `RgbaImage`; introduce a minimal capture-source abstraction so
the orchestrator's vision handler is source-agnostic. `hasNativeCapture()` semantics
extend to "camera available on Android."

**Permissions.** Runtime `CAMERA` permission (Android manifest + a first-use prompt).
WebView `getUserMedia` must be allowed (Tauri Android config / WebChromeClient permission
grant).

### 5.5 New work — Vision geometry (perspective correction)

The existing detector (`vision/detect.ts`) assumes an **axis-aligned, pixel-perfect**
board (edge profiles + autocorrelation, no perspective handling). A hand-held photo of a
screen has keystone/perspective, rotation, glare, and moiré. We insert one new stage
**before** the existing pipeline:

New module **`vision/warp.ts`** (pure TS, unit-testable):
1. **Quad detection** — locate the board's four corners in the framed photo (constrained by
   the on-screen guide to keep the search cheap and robust).
2. **Homography warp** — map the detected quad → a fixed N×N axis-aligned square,
   resampling with the repo's **existing pure-TS bilinear resampler** (already written for
   the OpenCV-free path).
3. Hand the clean square to the **unchanged** `detect.ts → pieces.ts → position.ts →
   tracker.ts` pipeline. Detection is now near-trivial (already axis-aligned).

Because the warp preserves the board's rank/file coordinate labels and the last-move
highlight, the recent **orientation-from-coord-labels** (`vision/coords.ts`) and
**side-to-move-from-last-move-highlight** (`detect.ts` warm-tint pair + `position.ts`
`guessSideToMove`) logic continues to work on the warped image.

**Fallbacks / backstops:**
- Low auto-quad confidence → **manual four-corner tap** UI → same homography warp.
- The existing **Edit screen** lets the user correct any misread square before analyzing —
  the human safety net for glare/moiré-degraded reads.

### 5.6 Cross-origin isolation on Android

`onnxruntime-web` wants COOP `same-origin` + COEP `require-corp` (for `SharedArrayBuffer` /
threaded wasm). Desktop sets these via `tauri.conf.json` `app.security.headers`. **Confirm
these headers are served on the Android custom scheme.** If not achievable, `onnxruntime-web`
falls back to **single-threaded** wasm — slower but functional. This is a known,
bounded risk with a working fallback, not a blocker.

## 6. Feature scope — MVP flow

```
Home ("Capture position")
  → CameraOverlay (new: live preview + square guide + board-side Auto/White/Black)
    → capture frame → warp (auto quad, else manual tap)
      → vision (detect → pieces → position → tracker) → FEN
        → Edit (confirm / fix squares, side to move)
          → Analysis (reused: native Stockfish streams eval, best lines, move classification)
```

**Screens shipped:** Home, CameraOverlay (new), Edit, Analysis.
**Dropped from MVP:** Report, Review, screen-region overlay, add-engine / external-engine
picker, per-engine UCI options panel (reduced to fixed mobile Threads/Hash), desktop
Titlebar (frameless-window chrome, irrelevant on Android).

## 7. Testing strategy

- **Unit (Vitest, pure TS):** `vision/warp.ts` gets tests first (synthetic
  perspective-distorted board with known corners → assert the warped output is the expected
  square; quad-detection confidence thresholds; manual-corner path). Follows the repo's
  **TDD-first, tests-as-spec** convention.
- **Regression:** the full existing suite (~580 cases) stays green — desktop capture and
  engine paths are untouched.
- **Manual on-device gate:** camera capture, the native `.so` engine spawn, and real-glass
  capture quality are verified on a **real Android device** photographing a real screen —
  mirroring the project's existing manual desktop gate. This gate is where risks #1 and #2
  (§8) are actually retired.

## 8. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Cross-origin isolation** unavailable on the Android WebView scheme → no `SharedArrayBuffer` for ORT threads | Fall back to single-threaded `onnxruntime-web` (slower, works). Confirm header support early. |
| 2 | **Executing the bundled `.so`** — the `lib*.so`-in-`jniLibs` + `extractNativeLibs=true` + spawn-from-`nativeLibraryDir` chain must actually work on-device | **Spike this first on a real device** before building the rest; it validates the entire native-engine decision. |
| 3 | **APK size** — embedded NNUE net + ORT wasm + `.so` | arm64-v8a only for MVP; consider a smaller embedded net; document the size. |
| 4 | **Real-world capture quality** — glare / moiré / keystone from photographing a screen | Guided framing + manual-tap fallback + Edit-screen correction as the human backstop. |
| 5 | **Camera + vision worker on one page** performance on mobile | Capture a still frame (not continuous video into vision); reuse the on-demand capture model the desktop already uses. |

## 9. Sequencing (high-level — detailed plan comes next)

The recommended build order front-loads the two make-or-break validations so a dead end is
discovered cheaply:

1. **Engine spike (risk #2):** cross-compile Stockfish for arm64, get `libstockfish.so`
   into `jniLibs`, and prove a spawned-from-`nativeLibraryDir` process answers `uci` /
   `isready` on a real device. Validates the native-engine choice before anything is built
   on top of it.
2. **Android target bootstrap:** `tauri android init`, confirm the shared frontend loads in
   the WebView; check COOP/COEP + ORT (risk #1).
3. **Engine bridge:** Kotlin plugin (`start`/`send`/`stop`) + `nativeEngine.ts` platform
   switch; wire Analysis to it.
4. **Camera capture:** `CameraCapturer` + `CameraOverlay` producing an `RgbaImage`.
5. **Perspective correction:** `vision/warp.ts` (TDD) + manual-tap fallback; feed the
   existing pipeline.
6. **Integrate the MVP flow** (Home → Camera → warp → vision → Edit → Analysis) and hide
   out-of-scope UI on Android.
7. **Package** a release-signed arm64 APK; run the manual on-device gate.

## 10. Open questions / follow-ups

- Exact NNUE net choice for the embedded Android build (full vs a smaller net) — resolved
  during the engine spike against measured size + strength.
- Whether the engine bridge is cleanest as a Kotlin Tauri plugin vs Rust-side JNI to fetch
  `nativeLibraryDir` — defaulting to the **Kotlin plugin** (idiomatic Tauri mobile); revisit
  if the spike surfaces friction.
- Post-MVP: additional ABIs (armeabi-v7a / x86_64 emulator), Report/Review on mobile
  (needs a PGN-in or multi-capture path), iOS, Play Store signing/size work.
