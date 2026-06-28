# Svelte + Tauri Migration — Phase 2: Tauri Shell + Rust Capture + Vision Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a thin **Tauri 2 (Rust) desktop shell** whose only native job is screen capture, port the Python computer-vision pipeline (`detect` / `pieces` / `position` / `tracker`) to **TypeScript + onnxruntime-web** running in a **Web Worker**, and wire the orchestrator's four vision commands so ChessMenthol reaches **vision parity inside the desktop window** — on-demand "Capture Board" with region select, detected orientation, and low-confidence squares.

**Architecture:** The Rust layer exposes one `#[command] capture_frame()` (via the `xcap` crate) returning the primary monitor as raw RGBA bytes over Tauri's binary IPC. The renderer crops to the active region and posts the crop to a **vision worker** that runs the ported `detect` → `crop` → `classify` (onnxruntime-web) → `assemble` pipeline and returns a plain-data `AssembledPosition`. The orchestrator's four inert vision handlers (`capture_now`, `request_region_shot`, `set_region`, `clear_region`) become real async handlers that update `visionStatus` / `detectedOrientation` / `lowConfidence` / `region` and apply detected placements (placement-only comparison). The CV/logic modules are **pure and directly unit-tested** against the ported Python golden fixtures; the worker is a thin shell.

**Tech Stack:** TypeScript, Svelte 5, Vite, Vitest (already set up); **Tauri 2.11** (`@tauri-apps/api`, `@tauri-apps/cli`, `tauri`/`tauri-build` crates) + **`xcap` 0.9.6** (Rust capture); **`onnxruntime-web` 1.27** (browser inference) + **`onnxruntime-node` 1.27** (test-time parity) + **`pngjs`** (fixture decode in tests); the existing Phase 1b `core/orchestrator.ts` + `core/chess.ts` (chessops).

**Spec:** `docs/superpowers/specs/2026-06-28-svelte-tauri-migration-design.md` (§2.1 parity contract, §3 architecture, §6 vision capture flow, §9 Phase 2). **Builds on:** Phase 1b (`docs/superpowers/plans/2026-06-28-svelte-tauri-phase-1b-orchestrator-ui.md`).

---

## Conventions (read before starting)

- **Tests** live in `frontend/src/tests/`, named `<thing>.test.ts`; run `cd frontend && npm run test`; one file `cd frontend && npx vitest run src/tests/<f>.test.ts`. Typecheck: `cd frontend && npx tsc -p tsconfig.app.json --noEmit`.
- **Faithful ports use the committed Python as the line-by-line spec.** Each port task names its source file; reproduce its behavior and **port its pytest cases to Vitest** (the parity gate). The Python source + its tests ARE the complete spec — this is the same convention Phase 1b used; it is NOT a placeholder. Novel glue (Rust, the worker, ort inference, the bilinear resize, capture wrapper, orchestrator wiring, chessops board-building) is given as complete code here.
- **Each task group leaves the app working.** Groups i–iii are additive (the pure-web app under `vite dev` is untouched; the desktop app runs but vision is still gated off). Group iv wires the orchestrator behind the injected-tracker seam (no tracker injected ⇒ unchanged behavior). Group v flips the UI on under Tauri. Group vi verifies.

### ⚠️ Color-space parity convention (the silent-break risk — get this right everywhere)

The Python pipeline works in **BGR** (OpenCV). The new pipeline works in **RGBA** (what `xcap`, `ImageData`, and `<canvas>` all produce). To stay byte-parity with the Python golden tests:

1. **Reverse every Python BGR colour constant to RGB.** Python light `(181,217,240)` BGR → TS `(240,217,181)` RGB; dark `(99,136,181)` BGR → TS `(181,136,99)` RGB; bg `(60,60,60)` → `(60,60,60)`; highlight `(90,200,230)` BGR → `(230,200,90)` RGB; piece blob `(20,20,20)` → `(20,20,20)`.
2. **Grayscale = `round(0.299*R + 0.587*G + 0.114*B)`** reading R,G,B from RGBA channels [0,1,2] (matches `cv2.COLOR_BGR2GRAY` on the BGR image — same luma, integer-rounded, `.astype(float32)` after).
3. **The piece classifier feeds R,G,B directly (no swap).** `blobFromImages(swapRB=True)` on BGR crops yields RGB; our crops are already RGB, so we skip the swap. Same `1/255` scale, same NCHW `[N,3,32,32]`, same class order.
4. Highlight/cell-mean L2 deviations are channel-permutation invariant, so they match regardless of storage order as long as grayscale (rule 2) is computed correctly.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src-tauri/Cargo.toml` · `build.rs` · `tauri.conf.json` · `capabilities/default.json` | Tauri 2 project metadata, build hook, window + COOP/COEP config, default capability. |
| `frontend/src-tauri/src/main.rs` · `src/lib.rs` | Entry point + `capture_frame` command (xcap → header+RGBA via `tauri::ipc::Response`). |
| `frontend/src/lib/capture.ts` | Main-thread `Capturer`: `isTauri()` gate, `invoke('capture_frame')` → `ImageData`, region crop. |
| `frontend/src/vision/types.ts` | `square_name`, `Region`, `BoardLocation`, `SquareImage`, `Orientation`, `RgbaImage`. Port of `vision/types.py`. |
| `frontend/src/vision/detect.ts` | Grayscale + Sobel + autocorrelation + phase + confidence + orientation + highlights + `cropSquares`. Port of `vision/detect.py`. |
| `frontend/src/vision/position.ts` | `SquareLabel`, `AssembledPosition`, `assemble`, `guessOrientation`, `guessSideToMove`, `inferMove`. Port of `position.py`. |
| `frontend/src/vision/pieces.ts` | Hand-rolled `INTER_LINEAR` resize + `preprocess` (NCHW /255 RGB) + `postprocess` (softmax) + `CLASSES` + `PieceClassifier`. Port of `vision/pieces.py`. |
| `frontend/src/vision/tracker.ts` | `Tracker` (classifier + prev-board + overrides; `detectPosition(image)`). Port of `vision/tracker.py` (minus the capturer). |
| `frontend/src/vision/vision-worker.ts` | Worker entry: ort `PieceClassifier` + `Tracker`; message protocol. |
| `frontend/src/vision/visionClient.ts` | Main-thread worker wrapper (promise API) + `VisionTracker` facade (Capturer + worker) that the orchestrator injects. |
| `frontend/src/core/chess.ts` (modify) | Add `boardFenOf`, `assembleFromGrid` (build + validate an arbitrary placement), `epSquareFen`. |
| `frontend/src/core/serialize.ts` (modify) | Add `regionShotToDict` (TS JPEG encode). |
| `frontend/src/core/orchestrator.ts` (modify) | Vision state + tracker seam; real async vision handlers; `setTurn` side-override; `_stateFrame` vision fields. |
| `frontend/src/lib/engineClient.ts` (modify) | Construct + inject `VisionTracker` when `isTauri()`. |
| `frontend/src/App.svelte` (modify) | `hasCapture = isTauri()`; orientation auto-follow + low-confidence highlight parity. |
| `frontend/vite.config.ts` (modify) | `outDir → dist`; `optimizeDeps.exclude: ['onnxruntime-web']`. |
| `frontend/scripts/copy-vision-assets.mjs` | Copy `pieces.onnx` + ort wasm into `public/`. Wired predev/prebuild. |
| `frontend/scripts/copy-vision-fixtures.mjs` | One-time: copy the Python vision fixtures into `src/tests/fixtures/vision/`. |
| `frontend/src/tests/visionFixtures.ts` | Test helpers: `renderBoard()` (TS port of `synthetic.py`), `iou()`, `loadFixturePng()` (pngjs). |

---

## Parity contract (the definition of done)

From the spec §2.1 and `server/orchestrator.py` (`_capture_now`/`_request_region_shot`/`_set_region`/`_clear_region`/`_apply_detection`):

- **Commands:** `capture_now` (detect current region → apply placement), `request_region_shot` (full-desktop JPEG → `region_shot` frame), `set_region {left,top,width,height}` (validate, store, **immediately capture**), `clear_region` (region→null, status→idle). `set_turn` also pushes a **side override** to the tracker.
- **State fields:** `visionStatus ∈ {idle, found, low_confidence, no_board}`, `detectedOrientation ∈ {white, black, null}` (`white_bottom→white`, `black_bottom→black`), `lowConfidence: string[]`, `region: {left,top,width,height}|null`.
- **Behaviors:** placement-only comparison (`assembled.fen.split()[0] != board placement` ⇒ apply; else just re-emit); illegal/None detection ⇒ `no_board`; on-demand only (no polling); the existing `SourceControls`/`RegionOverlay` UI; degrade to analysis-only when not in Tauri.

---

## Task Group i — Tauri 2 shell + Rust capture + JS capture wrapper

### Task i.1: Scaffold the Tauri 2 project (no capture command yet)

**Files:** Create `frontend/src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json,src/main.rs,src/lib.rs,.gitignore}`; modify `frontend/package.json`, `frontend/vite.config.ts`.

- [ ] **Step 1: Add the Tauri npm deps + script**

```bash
cd frontend && npm install -D @tauri-apps/cli@^2.11.3 && npm install @tauri-apps/api@^2.11.1
```
Then add to `frontend/package.json` `scripts` (alongside the existing keys): `"tauri": "tauri"`.

- [ ] **Step 2: Repoint the Vite build output**

In `frontend/vite.config.ts`, change `build.outDir` from `'../chessmenthol/server/static'` to `'dist'` (Tauri's `frontendDist` resolves to `../dist`). The Python static dir is dead after the Phase 1b cutover. Leave the `server.headers` COOP/COEP block as-is.

```ts
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
```

- [ ] **Step 3: Create `frontend/src-tauri/Cargo.toml`**

```toml
[package]
name = "chessmenthol"
version = "0.1.0"
edition = "2021"

[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
xcap = "0.9"
```

- [ ] **Step 4: Create `frontend/src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 5: Create `frontend/src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "ChessMenthol",
  "version": "0.1.0",
  "identifier": "com.chessmenthol.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      { "title": "ChessMenthol", "width": 1280, "height": 800, "resizable": true, "fullscreen": false }
    ],
    "security": {
      "csp": null,
      "headers": {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp"
      }
    }
  },
  "bundle": { "active": true, "targets": "all" }
}
```

- [ ] **Step 6: Create `frontend/src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "default capability for the main window",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```
> App-defined commands registered via `generate_handler!` are callable without an explicit ACL permission; this default capability only grants the core window/event APIs.

- [ ] **Step 7: Create `frontend/src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run()
}
```

- [ ] **Step 8: Create `frontend/src-tauri/src/lib.rs` (stub command for now)**

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Placeholder; replaced by capture_frame in Task i.2.
#[tauri::command]
fn ping() -> &'static str {
    "pong"
}
```

- [ ] **Step 9: Create `frontend/src-tauri/.gitignore`**

```
/target
/gen/schemas
```

- [ ] **Step 10: Verify the shell builds and opens the existing app**

```bash
cd frontend && npm run tauri dev
```
Expected: `cargo` compiles `app_lib`; a native window opens showing the existing ChessMenthol UI (analysis works; vision controls still hidden because `hasCapture` is `false`). Close the window. If Linux build fails on missing system libs, install: `pkg-config libclang-dev libxcb1-dev libxrandr-dev libdbus-1-dev libpipewire-0.3-dev libwayland-dev libegl-dev` plus the WebKitGTK dev packages your distro names (`webkit2gtk-4.1`).

- [ ] **Step 11: Commit**

```bash
cd frontend && git add src-tauri package.json package-lock.json vite.config.ts && git commit -m "feat(tauri): scaffold Tauri 2 desktop shell wrapping the existing Vite app (Task i.1)"
```

---

### Task i.2: Rust `capture_frame` command (xcap → header + RGBA)

**Files:** Modify `frontend/src-tauri/src/lib.rs`.

Screen capture cannot be unit-tested headlessly; the correctness gate is the manual devtools check in Step 3 and the end-to-end check in Group vi. Keep the command tiny.

- [ ] **Step 1: Replace `ping` with `capture_frame`**

```rust
use xcap::Monitor;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![capture_frame])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Capture the primary monitor as RGBA. Returns an 8-byte little-endian header
/// [width u32][height u32] followed by width*height*4 RGBA bytes, sent over
/// Tauri's binary IPC (no JSON serialization of the pixel buffer).
#[tauri::command]
fn capture_frame() -> Result<tauri::ipc::Response, String> {
    let monitors = Monitor::all().map_err(|e| format!("enumerate monitors: {e}"))?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or_else(|| "no primary monitor found".to_string())?;
    let img = monitor
        .capture_image()
        .map_err(|e| format!("capture failed: {e}"))?;
    let (width, height) = (img.width(), img.height());
    let rgba = img.as_raw();

    let mut buf = Vec::with_capacity(8 + rgba.len());
    buf.extend_from_slice(&width.to_le_bytes());
    buf.extend_from_slice(&height.to_le_bytes());
    buf.extend_from_slice(rgba);
    Ok(tauri::ipc::Response::new(buf))
}
```

- [ ] **Step 2: Build**

```bash
cd frontend/src-tauri && cargo build
```
Expected: compiles clean (xcap + image resolve). Returns to a prompt; no run yet.

- [ ] **Step 3: Manual capture check in the running app**

```bash
cd frontend && npm run tauri dev
```
In the app window's devtools console:
```js
const { invoke } = await import('@tauri-apps/api/core');
const buf = await invoke('capture_frame');
const v = new DataView(buf);
console.log('size', v.getUint32(0, true), 'x', v.getUint32(4, true), 'bytes', buf.byteLength);
// byteLength should equal 8 + width*height*4
```
Expected: prints your primary monitor's resolution and a matching byte length. On Wayland (GNOME/KDE) the first call may pop a one-time screenshot-permission dialog — accept it. Close the window.

- [ ] **Step 4: Commit**

```bash
cd frontend && git add src-tauri/src/lib.rs && git commit -m "feat(tauri): capture_frame command grabs the primary monitor as RGBA via xcap (Task i.2)"
```

---

### Task i.3: `lib/capture.ts` — JS capture wrapper (TDD)

**Files:** Create `frontend/src/lib/capture.ts`, `frontend/src/tests/capture.test.ts`.

The decode-header + region-crop logic is pure and unit-testable with a mocked `invoke`. `RgbaImage` is our plain-data image (`{ data: Uint8ClampedArray, width, height }`) — structured-clone safe for the worker.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/tests/capture.test.ts
import { describe, it, expect, vi } from 'vitest';
import { decodeCaptureBuffer, cropImage, type RgbaImage } from '../lib/capture';

function header(w: number, h: number, rgba: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(8 + rgba.length);
  const v = new DataView(buf);
  v.setUint32(0, w, true);
  v.setUint32(4, h, true);
  new Uint8Array(buf, 8).set(rgba);
  return buf;
}

describe('decodeCaptureBuffer', () => {
  it('reads width/height header and views the RGBA tail', () => {
    const img = decodeCaptureBuffer(header(2, 1, [10, 20, 30, 255, 40, 50, 60, 255]));
    expect(img.width).toBe(2);
    expect(img.height).toBe(1);
    expect(Array.from(img.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });
});

describe('cropImage', () => {
  it('extracts a sub-rectangle in RGBA', () => {
    // 3x2 image; rows: [A B C] / [D E F], each pixel 4 bytes value v -> [v,v,v,255]
    const px = (v: number) => [v, v, v, 255];
    const data = new Uint8ClampedArray([...px(1), ...px(2), ...px(3), ...px(4), ...px(5), ...px(6)]);
    const src: RgbaImage = { data, width: 3, height: 2 };
    const crop = cropImage(src, { left: 1, top: 0, width: 2, height: 2 });
    expect(crop.width).toBe(2);
    expect(crop.height).toBe(2);
    // pixels B,C (row0) then E,F (row1)
    expect(Array.from(crop.data)).toEqual([...px(2), ...px(3), ...px(5), ...px(6)]);
  });
  it('clamps a region that runs past the image edge', () => {
    const data = new Uint8ClampedArray(2 * 2 * 4).fill(9);
    const crop = cropImage({ data, width: 2, height: 2 }, { left: 1, top: 1, width: 5, height: 5 });
    expect(crop.width).toBe(1);
    expect(crop.height).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/tests/capture.test.ts`
Expected: FAIL — cannot resolve `../lib/capture`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/lib/capture.ts
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Region } from './region';

/** Plain-data RGBA image; structured-clone safe for the vision worker. */
export interface RgbaImage {
  data: Uint8ClampedArray; // RGBA, length === width*height*4
  width: number;
  height: number;
}

/** True when the native capture command is available (running inside Tauri). */
export function hasNativeCapture(): boolean {
  return isTauri();
}

/** Decode the [width u32 LE][height u32 LE][RGBA...] buffer from capture_frame. */
export function decodeCaptureBuffer(buf: ArrayBuffer): RgbaImage {
  const v = new DataView(buf);
  const width = v.getUint32(0, true);
  const height = v.getUint32(4, true);
  // Copy out of the IPC buffer so the worker can take ownership of the bytes.
  const data = new Uint8ClampedArray(buf.slice(8));
  return { data, width, height };
}

/** Crop an RGBA image to a region, clamped to the image bounds. */
export function cropImage(src: RgbaImage, region: Region): RgbaImage {
  const left = Math.max(0, Math.min(region.left, src.width));
  const top = Math.max(0, Math.min(region.top, src.height));
  const width = Math.max(0, Math.min(region.width, src.width - left));
  const height = Math.max(0, Math.min(region.height, src.height - top));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcStart = ((top + y) * src.width + left) * 4;
    out.set(src.data.subarray(srcStart, srcStart + width * 4), y * width * 4);
  }
  return { data: out, width, height };
}

/** The main-thread screen capturer: grabs the full desktop and crops to a region. */
export class Capturer {
  private region: Region | null = null;

  setRegion(region: Region | null): void {
    this.region = region;
  }

  async grabFullDesktop(): Promise<RgbaImage> {
    const buf = (await invoke('capture_frame')) as ArrayBuffer;
    return decodeCaptureBuffer(buf);
  }

  /** Full desktop cropped to the active region (or the whole frame if unset). */
  async grab(): Promise<RgbaImage> {
    const full = await this.grabFullDesktop();
    return this.region === null ? full : cropImage(full, this.region);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/tests/capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && git add src/lib/capture.ts src/tests/capture.test.ts && git commit -m "feat(vision): lib/capture.ts wrapper over capture_frame (decode + region crop) (Task i.3)"
```

---

## Task Group ii — Port the pure vision/position logic (TDD vs ported golden fixtures)

### Task ii.0: Vision assets + test fixtures

**Files:** Create `frontend/scripts/copy-vision-assets.mjs`, `frontend/scripts/copy-vision-fixtures.mjs`; modify `frontend/package.json`, `frontend/.gitignore`.

- [ ] **Step 1: Add deps (ort + fixture decoder)**

```bash
cd frontend && npm install onnxruntime-web@^1.27.0 && npm install -D onnxruntime-node@^1.27.0 pngjs @types/pngjs
```

- [ ] **Step 2: Asset copy script (model + ort wasm into public/)**

```js
// frontend/scripts/copy-vision-assets.mjs
// Copies the piece-classifier model and the onnxruntime-web wasm runtime into
// public/ so they are served same-origin (COEP require-corp blocks cross-origin).
import { mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUB = join(here, '..', 'public');

// 1. Model: chessmenthol/models/pieces.onnx -> public/models/pieces.onnx
const MODEL_SRC = join(here, '..', '..', 'chessmenthol', 'models', 'pieces.onnx');
if (!existsSync(MODEL_SRC)) { console.error(`[copy-vision-assets] missing ${MODEL_SRC}`); process.exit(1); }
mkdirSync(join(PUB, 'models'), { recursive: true });
copyFileSync(MODEL_SRC, join(PUB, 'models', 'pieces.onnx'));

// 2. ort runtime: node_modules/onnxruntime-web/dist/*.wasm + *.mjs -> public/ort/
const ORT_SRC = join(here, '..', 'node_modules', 'onnxruntime-web', 'dist');
mkdirSync(join(PUB, 'ort'), { recursive: true });
for (const f of readdirSync(ORT_SRC)) {
  if (f.endsWith('.wasm') || f.endsWith('.mjs')) copyFileSync(join(ORT_SRC, f), join(PUB, 'ort', f));
}
console.log('[copy-vision-assets] copied pieces.onnx + ort runtime into public/');
```

- [ ] **Step 3: Fixture copy script (Python vision fixtures → frontend tests)**

```js
// frontend/scripts/copy-vision-fixtures.mjs
// One-time: copy the committed Python vision fixtures into the frontend test tree.
import { cpSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'tests', 'vision', 'fixtures');
const DST = join(here, '..', 'src', 'tests', 'fixtures', 'vision');
mkdirSync(DST, { recursive: true });
cpSync(SRC, DST, { recursive: true }); // 4 board PNGs + ground_truth.json + pieces/*/*.png
console.log(`[copy-vision-fixtures] copied ${SRC} -> ${DST}`);
```

- [ ] **Step 4: Wire scripts + ignore generated dirs**

In `frontend/package.json`, extend `predev`/`prebuild` to also copy vision assets, and add a one-off script:
```json
    "predev": "node scripts/copy-engine.mjs && node scripts/copy-vision-assets.mjs",
    "prebuild": "node scripts/copy-engine.mjs && node scripts/copy-vision-assets.mjs",
    "copy-vision-assets": "node scripts/copy-vision-assets.mjs",
    "copy-vision-fixtures": "node scripts/copy-vision-fixtures.mjs"
```
Append to `frontend/.gitignore`:
```bash
cd frontend && printf '\n# generated by scripts/copy-vision-assets.mjs\npublic/models/\npublic/ort/\n' >> .gitignore
```

- [ ] **Step 5: Exclude ort from Vite pre-bundling**

In `frontend/vite.config.ts`, add (merge into the existing `defineConfig({...})`):
```ts
  optimizeDeps: { exclude: ['onnxruntime-web'] },
```
(Forgetting this is the classic "failed to load wasm / worker is not defined" dev error.)

- [ ] **Step 6: Run the scripts; commit the fixtures**

```bash
cd frontend && node scripts/copy-vision-assets.mjs && node scripts/copy-vision-fixtures.mjs && ls public/models public/ort && ls src/tests/fixtures/vision
```
Expected: `pieces.onnx`, `ort-wasm-simd-threaded.wasm` present; the 4 board PNGs + `ground_truth.json` + `pieces/` copied. The fixtures are committed (test inputs); `public/models`+`public/ort` are gitignored (generated).
```bash
cd frontend && git add package.json package-lock.json .gitignore vite.config.ts scripts/copy-vision-assets.mjs scripts/copy-vision-fixtures.mjs src/tests/fixtures/vision && git commit -m "chore(vision): add ort + pngjs deps, asset/fixture copy scripts, committed test fixtures (Task ii.0)"
```

---

### Task ii.1: `vision/types.ts` + test helpers (`renderBoard`, `iou`, `loadFixturePng`)

**Files:** Create `frontend/src/vision/types.ts`, `frontend/src/tests/visionFixtures.ts`, `frontend/src/tests/visionTypes.test.ts`. Port `vision/types.py` (`square_name` + dataclasses) and `tests/vision/synthetic.py` (`render_board`) + `tests/vision/helpers.py` (`iou`).

- [ ] **Step 1: Write the failing test (port `test_square_name_*` + a render_board geometry check from `test_synthetic.py`)**

```ts
// frontend/src/tests/visionTypes.test.ts
import { describe, it, expect } from 'vitest';
import { squareName } from '../vision/types';
import { renderBoard } from './visionFixtures';

describe('squareName', () => {
  it('white_bottom maps geometric origin to a8 and h1', () => {
    expect(squareName(0, 0, 'white_bottom')).toBe('a8');
    expect(squareName(7, 7, 'white_bottom')).toBe('h1');
  });
  it('black_bottom flips files and ranks', () => {
    expect(squareName(0, 0, 'black_bottom')).toBe('h1');
    expect(squareName(7, 7, 'black_bottom')).toBe('a8');
  });
  it('null orientation defaults to white_bottom', () => {
    expect(squareName(0, 0, null)).toBe('a8');
    expect(squareName(7, 7, null)).toBe('h1');
  });
});

describe('renderBoard', () => {
  it('produces a deterministic axis-aligned board with ground-truth grid', () => {
    const { image, truth } = renderBoard({ square: 32, margin: 16 });
    expect(image.width).toBe(16 * 2 + 32 * 8);
    expect(truth.gridX).toEqual([16, 48, 80, 112, 144, 176, 208, 240, 272]);
    expect(truth.squareSize).toBe(32);
    expect(truth.orientationHint).toBe('white_bottom');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/tests/visionTypes.test.ts`
Expected: FAIL — cannot resolve `../vision/types`.

- [ ] **Step 3: Implement `vision/types.ts`** (port of `vision/types.py`; `RgbaImage` re-exported from `lib/capture.ts`)

```ts
// frontend/src/vision/types.ts
import type { RgbaImage } from '../lib/capture';
export type { RgbaImage };

export type Orientation = 'white_bottom' | 'black_bottom';

/** Geometric (col,row) — (0,0) at board top-left — to algebraic. Defaults to white_bottom. */
export function squareName(col: number, row: number, orientation: Orientation | null): string {
  if (orientation === 'black_bottom') {
    return `${String.fromCharCode('h'.charCodeAt(0) - col)}${row + 1}`;
  }
  return `${String.fromCharCode('a'.charCodeAt(0) + col)}${8 - row}`;
}

export interface Region { left: number; top: number; width: number; height: number; }

export interface BoardLocation {
  bbox: Region;
  gridX: number[]; // 9 vertical grid-line x-positions (left -> right)
  gridY: number[]; // 9 horizontal grid-line y-positions (top -> bottom)
  squareSize: number;
  orientationHint: Orientation | null;
  highlightSquares: string[];
  confidence: number;
}

export interface SquareImage { square: string; image: RgbaImage; }
```

- [ ] **Step 4: Implement the test helpers `frontend/src/tests/visionFixtures.ts`**

Port `synthetic.py::render_board` (colours reversed to RGB per the colour-space convention), `helpers.py::iou`, and a pngjs loader. `renderBoard` returns an `RgbaImage` + a ground-truth `BoardLocation`.

```ts
// frontend/src/tests/visionFixtures.ts
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { RgbaImage } from '../lib/capture';
import type { BoardLocation, Region } from '../vision/types';

// RGB (Python BGR constants reversed per the colour-space convention).
const LIGHT: [number, number, number] = [240, 217, 181];
const DARK: [number, number, number] = [181, 136, 99];
const BG: [number, number, number] = [60, 60, 60];
const HIGHLIGHT: [number, number, number] = [230, 200, 90];
const PIECE: [number, number, number] = [20, 20, 20];

function squareToColRow(sq: string): [number, number] {
  return [sq.charCodeAt(0) - 'a'.charCodeAt(0), 8 - Number(sq[1])];
}

function setPx(img: RgbaImage, x: number, y: number, [r, g, b]: [number, number, number]): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
}

export interface RenderOpts {
  square?: number; margin?: number;
  pieces?: string[]; highlights?: string[];
}

export function renderBoard(opts: RenderOpts = {}): { image: RgbaImage; truth: BoardLocation } {
  const square = opts.square ?? 32;
  const margin = opts.margin ?? 16;
  const boardPx = square * 8;
  const canvas = margin * 2 + boardPx;
  const image: RgbaImage = { data: new Uint8ClampedArray(canvas * canvas * 4), width: canvas, height: canvas };
  // background
  for (let y = 0; y < canvas; y++) for (let x = 0; x < canvas; x++) setPx(image, x, y, BG);
  // squares: (col+row) even -> light at top-left so bottom-left (row7,col0) is dark
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const color = (col + row) % 2 === 0 ? LIGHT : DARK;
    for (let dy = 0; dy < square; dy++) for (let dx = 0; dx < square; dx++) {
      setPx(image, margin + col * square + dx, margin + row * square + dy, color);
    }
  }
  // highlights: 0.5 blend with the tint
  for (const sq of opts.highlights ?? []) {
    const [col, row] = squareToColRow(sq);
    for (let dy = 0; dy < square; dy++) for (let dx = 0; dx < square; dx++) {
      const x = margin + col * square + dx, y = margin + row * square + dy;
      const i = (y * image.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        image.data[i + c] = Math.trunc(0.5 * image.data[i + c] + 0.5 * HIGHLIGHT[c]);
      }
    }
  }
  // pieces: filled circle radius square/3 at cell centre
  for (const sq of opts.pieces ?? []) {
    const [col, row] = squareToColRow(sq);
    const cx = margin + col * square + Math.trunc(square / 2);
    const cy = margin + row * square + Math.trunc(square / 2);
    const r = Math.trunc(square / 3);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) setPx(image, cx + dx, cy + dy, PIECE);
    }
  }
  const gridX = Array.from({ length: 9 }, (_, i) => margin + i * square);
  const gridY = gridX.slice();
  const truth: BoardLocation = {
    bbox: { left: margin, top: margin, width: boardPx, height: boardPx },
    gridX, gridY, squareSize: square, orientationHint: 'white_bottom',
    highlightSquares: [...(opts.highlights ?? [])], confidence: 1.0,
  };
  return { image, truth };
}

export function iou(a: Region, b: Region): number {
  const ix0 = Math.max(a.left, b.left), iy0 = Math.max(a.top, b.top);
  const ix1 = Math.min(a.left + a.width, b.left + b.width);
  const iy1 = Math.min(a.top + a.height, b.top + b.height);
  const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  const union = a.width * a.height + b.width * b.height - inter;
  return union ? inter / union : 0;
}

/** Decode a committed PNG fixture to RGBA (pngjs, node test env). */
export function loadFixturePng(relPath: string): RgbaImage {
  const url = new URL(`./fixtures/vision/${relPath}`, import.meta.url);
  const png = PNG.sync.read(readFileSync(url));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/tests/visionTypes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/vision/types.ts src/tests/visionFixtures.ts src/tests/visionTypes.test.ts && git commit -m "feat(vision): types.ts (square_name + structs) + TS render_board/iou/png test helpers (Task ii.1)"
```

---

### Task ii.2: `vision/detect.ts` — board detection (HIGHEST RISK)

**Files:** Create `frontend/src/vision/detect.ts`, `frontend/src/tests/detect.test.ts`. **Port `chessmenthol/vision/detect.py` exactly** (it is the spec). Reproduce: RGBA→grayscale (colour-space rule 2), `Sobel ksize=3` with `BORDER_REFLECT_101`, `_dominant_period` (autocorrelation, smallest lag within 90% of peak in `[6, min(w,h)//8]`), `_best_phase` (brute-force start, teeth=9), `_cell_means` (1/8 inset), `_checker_confidence`, `_orientation_hint`, `_highlight_squares` (mean+3σ), and `cropSquares` (1/12 inset, canonical a1..h8 order). Keep the module constants identical (`_MIN_SQUARE=6`, `_CELL_INSET_DIVISOR=8`, `_CHECKER_SPREAD_WEIGHT=2.0`, `_DEFAULT_MIN_CONFIDENCE=0.3`).

> Implementation notes for parity: (1) grayscale is integer-rounded then treated as float. (2) The 3×3 Sobel kernels are `Gx = [[-1,0,1],[-2,0,2],[-1,0,1]]`, `Gy = Gxᵀ`; use reflect-101 indexing `idx = mirror(i)` where out-of-range `i` reflects without repeating the edge (`-1→1`, `n→n-2`). (3) `_edge_profiles` returns `gx.sum(axis=0)` (length W) and `gy.sum(axis=1)` (length H) of the **absolute** gradients. (4) `_dominant_period` subtracts the mean, full autocorrelation, lags `0..n-1`, window `[lo, min(maxSq+1, n-1))`, threshold `0.90*peak`, pick the smallest qualifying lag. Average the x/y periods and round. (5) highlights: per-cell L2 deviation from the per-parity mean colour, threshold `mean+3*std`, top 2 by deviation, named via `squareName(col,row,orientation)`.

- [ ] **Step 1: Write the failing test (port `test_detect.py` + representative `test_detect_robustness.py` + one `test_detect_real.py` case)**

```ts
// frontend/src/tests/detect.test.ts
import { describe, it, expect } from 'vitest';
import { detect, cropSquares } from '../vision/detect';
import { renderBoard, iou, loadFixturePng } from './visionFixtures';
import groundTruth from './fixtures/vision/ground_truth.json';

describe('detect — synthetic golden boards', () => {
  it('clean board: bbox IoU > 0.95, 9x9 grid, square ~40, confidence > 0.6', () => {
    const { image, truth } = renderBoard({ square: 40, margin: 24 });
    const loc = detect(image);
    expect(loc).not.toBeNull();
    expect(iou(loc!.bbox, truth.bbox)).toBeGreaterThan(0.95);
    expect(loc!.gridX).toHaveLength(9);
    expect(loc!.gridY).toHaveLength(9);
    expect(Math.abs(loc!.squareSize - 40)).toBeLessThanOrEqual(2);
    expect(loc!.confidence).toBeGreaterThan(0.6);
  });

  it('no-margin board: IoU > 0.90', () => {
    const { image, truth } = renderBoard({ square: 40, margin: 0 });
    const loc = detect(image);
    expect(loc).not.toBeNull();
    expect(iou(loc!.bbox, truth.bbox)).toBeGreaterThan(0.90);
  });

  it('rejects pure noise (returns null)', () => {
    // deterministic LCG noise (no Math.random in tests-as-fixtures)
    let s = 1; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const n = 300; const data = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : Math.floor(rnd() * 256);
    expect(detect({ data, width: n, height: n })).toBeNull();
  });

  it('detects orientation hint white_bottom', () => {
    const { image } = renderBoard({ square: 40, margin: 24 });
    expect(detect(image)!.orientationHint).toBe('white_bottom');
  });

  it('finds highlight squares e2,e4 and none on a clean board', () => {
    const hl = detect(renderBoard({ square: 40, margin: 24, highlights: ['e2', 'e4'] }).image)!;
    expect(new Set(hl.highlightSquares)).toEqual(new Set(['e2', 'e4']));
    expect(detect(renderBoard({ square: 40, margin: 24 }).image)!.highlightSquares).toEqual([]);
  });

  it('robustness: IoU > 0.95 across geometry + theme variants', () => {
    for (const [square, margin] of [[24, 8], [32, 16], [40, 24], [56, 4], [64, 40]] as const) {
      const { image, truth } = renderBoard({ square, margin });
      const loc = detect(image);
      expect(loc, `square=${square} margin=${margin}`).not.toBeNull();
      expect(iou(loc!.bbox, truth.bbox)).toBeGreaterThan(0.95);
    }
  });
});

describe('cropSquares', () => {
  it('returns 64 crops in canonical a1..h8 order', () => {
    const { image } = renderBoard({ square: 40, margin: 24 });
    const crops = cropSquares(image, detect(image)!);
    expect(crops).toHaveLength(64);
    expect(crops[0].square).toBe('a1');
    expect(crops[7].square).toBe('h1');
    expect(crops[63].square).toBe('h8');
  });
});

describe('detect — committed real boards', () => {
  it.each(Object.keys(groundTruth as Record<string, unknown>))('IoU > 0.9 on %s', (name) => {
    const gt = (groundTruth as Record<string, { left: number; top: number; width: number; height: number }>)[name];
    const loc = detect(loadFixturePng(name));
    expect(loc).not.toBeNull();
    expect(iou(loc!.bbox, gt)).toBeGreaterThan(0.9);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/tests/detect.test.ts`
Expected: FAIL — cannot resolve `../vision/detect`.

- [ ] **Step 3: Implement `vision/detect.ts`** (faithful port of `detect.py` per the notes above; the Python file is the line-by-line spec). Export `detect(image: RgbaImage, minConfidence = 0.3): BoardLocation | null` and `cropSquares(image: RgbaImage, location: BoardLocation): SquareImage[]`. Internal helpers mirror the Python (`grayscale`, `edgeProfiles`, `dominantPeriod`, `bestPhase`, `cellMeans`, `checkerConfidence`, `orientationHint`, `highlightSquares`). `cropSquares` sorts by python-chess index (`rank*8 + file`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/tests/detect.test.ts`
Expected: PASS (all synthetic, robustness, crop, and the 4 real-board cases). If a real-board IoU is marginal, recheck grayscale rounding and reflect-101 border — those are the usual parity culprits.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/vision/detect.ts src/tests/detect.test.ts && git commit -m "feat(vision): detect.ts board detection (port of detect.py) + golden-fixture parity (Task ii.2)"
```

---

### Task ii.3: `core/chess.ts` additions for arbitrary-placement assembly

**Files:** Modify `frontend/src/core/chess.ts`; add cases to `frontend/src/tests/coreChess.test.ts`.

`position.assemble` builds an arbitrary (possibly illegal) piece placement, sets castling/ep, and reports legality + a status string. chessops `Chess.fromSetup` returns an error for illegal setups, so we expose helpers that build a `Board`, attempt a `Chess`, and surface placement FEN + a status. This keeps chessops out of `position.ts`.

- [ ] **Step 1: Write the failing test (append to `coreChess.test.ts`)**

```ts
import { assembleFromGrid, boardFenOf } from '../core/chess';

describe('assembleFromGrid', () => {
  it('builds the start position from a placement grid (legal)', () => {
    // grid[row][col] in geometric order; row0=a8..h8. null = empty.
    const startGrid = [
      ['bR','bN','bB','bQ','bK','bB','bN','bR'],
      ['bP','bP','bP','bP','bP','bP','bP','bP'],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      ['wP','wP','wP','wP','wP','wP','wP','wP'],
      ['wR','wN','wB','wQ','wK','wB','wN','wR'],
    ];
    const res = assembleFromGrid(startGrid, { white: true });
    expect(res.isLegal).toBe(true);
    expect(res.placement).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    // full castling inferred from kings+rooks on home squares
    expect(res.fen).toContain(' w KQkq ');
  });

  it('flags an illegal two-white-kings placement', () => {
    const grid: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
    grid[0][4] = 'wK'; grid[7][4] = 'wK';
    const res = assembleFromGrid(grid, { white: true });
    expect(res.isLegal).toBe(false);
    expect(res.fen.split(' ')[0]).toBe('4K3/8/8/8/8/8/8/4K3');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/tests/coreChess.test.ts`
Expected: FAIL — `assembleFromGrid` is not exported.

- [ ] **Step 3: Implement the helpers in `core/chess.ts`**

```ts
// add imports at the top of core/chess.ts
import { Board } from 'chessops/board';
import { makeBoardFen } from 'chessops/fen';
import { defaultSetup } from 'chessops/setup';
import type { Piece } from 'chessops/types';

// piece-code "wP"/"bK"/null -> chessops Piece
const ROLE_OF: Record<string, Role> = {
  P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king',
};
function pieceFromCode(code: string | null): Piece | null {
  if (!code) return null;
  return { color: code[0] === 'w' ? 'white' : 'black', role: ROLE_OF[code[1]] };
}

/** Placement-only FEN field (python-chess board_fen equivalent). */
export function boardFenOf(pos: Chess): string {
  return makeBoardFen(pos.board);
}

export interface AssembleResult {
  fen: string;        // full FEN (en_passant shown if set)
  placement: string;  // first FEN field
  isLegal: boolean;
  status: string;     // 'valid' or a comma-joined reason
  pos: Chess | null;  // present only when legal
}

/**
 * Build a position from a geometric grid (grid[row][col], row0 = a8..h8) with the
 * given side to move. Castling rights are inferred from kings+rooks on home squares
 * (mirrors position.py `_infer_castling_rights`); ep is left unset here (the caller
 * sets it for an inferred double pawn push). Reports legality without throwing.
 */
export function assembleFromGrid(
  grid: (string | null)[][],
  opts: { white: boolean },
): AssembleResult {
  const board = Board.empty();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = pieceFromCode(grid[row][col]);
      if (piece) board.set(parseSquare(squareNameGeom(col, row))!, piece);
    }
  }
  const setup = { ...defaultSetup(), board, turn: (opts.white ? 'white' : 'black') as Color };
  setup.castlingRights = inferCastling(board);
  const result = Chess.fromSetup(setup);
  const placement = makeBoardFen(board);
  if (result.isOk) {
    const pos = result.unwrap();
    return { fen: makeFen(pos.toSetup()), placement, isLegal: true, status: 'valid', pos };
  }
  // Illegal: synthesize a FEN string for display/compare from the raw setup.
  const fen = `${placement} ${opts.white ? 'w' : 'b'} - - 0 1`;
  return { fen, placement, isLegal: false, status: String(result.unwrap ? 'invalid' : 'invalid'), pos: null };
}
```
Add these private helpers in `core/chess.ts` (geometric naming inlined to avoid a vision import, and home-square castling inference over a `Board`):
```ts
import { SquareSet } from 'chessops/squareSet';

function squareNameGeom(col: number, row: number): SquareName {
  return `${String.fromCharCode(97 + col)}${8 - row}` as SquareName;
}
function inferCastling(board: Board): SquareSet {
  let rights = SquareSet.empty();
  const at = (name: string) => board.get(parseSquare(name)!);
  const wk = at('e1'), bk = at('e8');
  if (wk && wk.role === 'king' && wk.color === 'white') {
    const h1 = at('h1'); const a1 = at('a1');
    if (h1 && h1.role === 'rook' && h1.color === 'white') rights = rights.with(parseSquare('h1')!);
    if (a1 && a1.role === 'rook' && a1.color === 'white') rights = rights.with(parseSquare('a1')!);
  }
  if (bk && bk.role === 'king' && bk.color === 'black') {
    const h8 = at('h8'); const a8 = at('a8');
    if (h8 && h8.role === 'rook' && h8.color === 'black') rights = rights.with(parseSquare('h8')!);
    if (a8 && a8.role === 'rook' && a8.color === 'black') rights = rights.with(parseSquare('a8')!);
  }
  return rights;
}
```
> The `status` string only needs to be non-`'valid'` for illegal positions (the parity test asserts `isLegal === false` + the placement FEN); reproducing python-chess's exact flag names is unnecessary, so a generic `'invalid'` is acceptable. If a later test needs the specific reason, map `result.unwrap` error variants then.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/tests/coreChess.test.ts`
Expected: PASS (existing cases + the two new ones).

- [ ] **Step 5: Typecheck + commit**

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && git add src/core/chess.ts src/tests/coreChess.test.ts && git commit -m "feat(core): assembleFromGrid + boardFenOf for arbitrary-placement vision assembly (Task ii.3)"
```

---

### Task ii.4: `vision/position.ts` — assemble / orientation / side / move inference

**Files:** Create `frontend/src/vision/position.ts`, `frontend/src/tests/position.test.ts`. **Port `chessmenthol/position.py`** using `core/chess.ts` (`assembleFromGrid`, `boardFenOf`, `playUci`, `legalMovesUci`). `AssembledPosition` is **plain data** (worker-cloneable): no chessops object held.

```ts
// shape to implement
export interface SquareLabel { piece: string | null; confidence: number; } // piece = "wP".."bK" | null
export interface AssembledPosition {
  fen: string;
  isLegal: boolean;
  status: string;
  lowConfidence: string[];
  move: string | null;          // inferred UCI move vs prevFen, or null
  orientation: Orientation;
  sideToMove: 'white' | 'black';
}
export function assemble(grid: SquareLabel[][], opts: {
  orientation: Orientation; white: boolean; prevFen?: string | null; confidenceThreshold?: number;
}): AssembledPosition;
export function guessOrientation(grid: SquareLabel[][]): Orientation | null;
export function guessSideToMove(fen: string, opts: {
  prevFen?: string | null; move?: string | null; highlightSquares?: string[];
}): 'white' | 'black';
export function inferMove(prevFen: string, newPlacement: string): string | null;
```

Port faithfully:
- **`assemble`**: build `grid` of piece-codes, call `assembleFromGrid(codes, {white})`; if legal and `prevFen` given, `inferMove` then set ep for an inferred double pawn push (re-derive the FEN with the ep field — use a small `withEpSquare(fen, uci)` helper that mirrors `_maybe_set_ep_square`); compute `lowConfidence` (squares with `confidence < 0.5`, named via `squareName(col,row,orientation)`).
- **`inferMove`**: for each legal UCI from `posFromFen(prevFen)`, play it and compare `boardFenOf(next) === newPlacement`; return the unique match or null (mirrors placement-only `infer_move`).
- **`guessOrientation`**: balance white/black piece counts in geometric rows [6,7] vs [0,1] (≥6 total else null).
- **`guessSideToMove`**: `prev+move` ⇒ opposite of prev's turn; else `highlightSquares` ⇒ the occupied highlighted square's piece colour's opposite; else white.

- [ ] **Step 1: Write the failing test — port `tests/test_position.py` (27 cases)**

Port every `test_position.py` case. Use a `boardToGrid(fen, orientation?, confidence?)` helper (TS port of `position_grids.py`) declared in the test file: for each geometric (row,col), read the piece at `squareName(col,row,orientation)` from `posFromFen(fen)` (via `roleAt` + colour) → `SquareLabel`. Cover: start-position round-trip (placement matches), orientation maps geometric origin, illegal two-white-kings (`isLegal=false`), low-confidence flagging (threshold 0.5), full-castling for start, `inferMove` quiet/capture/castling/promotion/en-passant, `guessOrientation` white/black/ambiguous, `guessSideToMove` from move/highlight. The Python file is the exact spec.

- [ ] **Step 2: Run to verify it fails** — `cd frontend && npx vitest run src/tests/position.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `vision/position.ts`** per the shape + port notes above.

- [ ] **Step 4: Run to verify it passes** — all 27 ported cases green.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/vision/position.ts src/tests/position.test.ts && git commit -m "feat(vision): position.ts assemble/orientation/side/infer_move (port of position.py) (Task ii.4)"
```

---

### Task ii.5: `vision/pieces.ts` — classifier (hand-rolled bilinear + onnxruntime)

**Files:** Create `frontend/src/vision/pieces.ts`, `frontend/src/tests/pieces.test.ts`. **Port `chessmenthol/vision/pieces.py`.** Reproduce `blobFromImages` with a **hand-rolled `INTER_LINEAR`** resize (cross-platform determinism), `/255`, NCHW `[N,3,32,32]`, RGB (no swap — colour-space rule 3), class order, softmax postprocess. `PieceClassifier` wraps an injected `InferenceSession` so the same class runs onnxruntime-web (worker) or onnxruntime-node (test).

```ts
// shapes
export const CLASSES = ['bB','bK','bN','bP','bQ','bR','wB','wK','wN','wP','wQ','wR','xx'] as const;
export const INPUT_SIZE = 32;
export function classToPiece(index: number): string | null;   // 'xx' -> null, else "wP".."bK"
export function pieceToClass(piece: string | null): number;
export function resizeBilinear(img: RgbaImage, size: number): RgbaImage; // OpenCV INTER_LINEAR
export function preprocess(crops: RgbaImage[]): Float32Array;  // length N*3*32*32, NCHW, /255, RGB
export function postprocess(logits: Float32Array, n: number): SquareLabel[]; // softmax argmax
export interface InferenceLike { run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>; inputNames: readonly string[]; outputNames: readonly string[]; }
export class PieceClassifier {
  constructor(session: InferenceLike);
  classify(crops: SquareImage[]): Promise<SquareLabel[]>; // empty -> []
}
```

**`resizeBilinear` (exact OpenCV INTER_LINEAR):** for each dst `(dx,dy)`, `fx=(dx+0.5)*srcW/size-0.5`, `x0=floor(fx)`, `ax=fx-x0`; clamp `x0,x0+1` to `[0,srcW-1]`; same for y; per channel `out = (1-ay)*((1-ax)*p00+ax*p01) + ay*((1-ax)*p10+ax*p11)`, rounded to nearest uint8. **`preprocess`:** resize each crop to 32×32, then for plane order R,G,B write `blob[((n*3+c)*32+y)*32+x] = px[c]/255`. **`postprocess`:** per row softmax over 13 logits, argmax → `classToPiece`, confidence = max prob.

- [ ] **Step 1: Write the failing test (port the pure `test_pieces.py` cases + the ≥95% real-crop gate via onnxruntime-node)**

```ts
// frontend/src/tests/pieces.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import { CLASSES, INPUT_SIZE, classToPiece, pieceToClass, preprocess, postprocess, resizeBilinear, PieceClassifier } from '../vision/pieces';
import { loadFixturePng } from './visionFixtures';

describe('pieces — pure', () => {
  it('class order + INPUT_SIZE', () => {
    expect([...CLASSES]).toEqual(['bB','bK','bN','bP','bQ','bR','wB','wK','wN','wP','wQ','wR','xx']);
    expect(INPUT_SIZE).toBe(32);
  });
  it('class<->piece bijection', () => {
    expect(classToPiece(CLASSES.indexOf('xx'))).toBeNull();
    expect(classToPiece(CLASSES.indexOf('wP'))).toBe('wP');
    for (let i = 0; i < CLASSES.length; i++) expect(pieceToClass(classToPiece(i))).toBe(i);
  });
  it('preprocess: NCHW shape, /255 normalization', () => {
    const black = Array.from({ length: 5 }, () => ({ data: new Uint8ClampedArray(40 * 40 * 4), width: 40, height: 40 }));
    expect(preprocess(black).length).toBe(5 * 3 * INPUT_SIZE * INPUT_SIZE);
    const whitePx = new Uint8ClampedArray(32 * 32 * 4).fill(255);
    expect(Math.abs(Math.max(...preprocess([{ data: whitePx, width: 32, height: 32 }])) - 1.0)).toBeLessThan(1e-3);
  });
  it('postprocess: argmax + softmax confidence', () => {
    const logits = new Float32Array(2 * 13).fill(-10);
    logits[CLASSES.indexOf('wP')] = 10; logits[13 + CLASSES.indexOf('xx')] = 10;
    const labels = postprocess(logits, 2);
    expect(labels[0].piece).toBe('wP');
    expect(labels[1].piece).toBeNull();
    expect(labels[0].confidence).toBeGreaterThan(0.99);
  });
  it('resizeBilinear keeps a flat colour flat', () => {
    const src = { data: new Uint8ClampedArray(40 * 40 * 4).fill(123), width: 40, height: 40 };
    const out = resizeBilinear(src, 32);
    expect(out.width).toBe(32);
    expect(out.data[0]).toBe(123);
  });
});

const MODEL = fileURLToPath(new URL('../../../chessmenthol/models/pieces.onnx', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures/vision/pieces', import.meta.url));
const maybe = existsSync(MODEL) ? describe : describe.skip;

maybe('pieces — committed model classifies real crops (>=95%)', () => {
  it('classifies the committed piece fixtures', async () => {
    const session = await ort.InferenceSession.create(MODEL);
    const clf = new PieceClassifier(session as any);
    const types = readdirSync(FIX);
    const crops = [], expected: string[] = [];
    for (const t of types) for (const f of readdirSync(`${FIX}/${t}`)) {
      crops.push({ square: 'a1', image: loadFixturePng(`pieces/${t}/${f}`) });
      expected.push(t);
    }
    const labels = await clf.classify(crops);
    const correct = labels.filter((l, i) => CLASSES[pieceToClass(l.piece)] === expected[i]).length;
    expect(correct / crops.length).toBeGreaterThanOrEqual(0.95);
  }, 30_000);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && npx vitest run src/tests/pieces.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `vision/pieces.ts`** per the shapes + bilinear spec. `PieceClassifier.classify` builds the blob, runs `session.run({ [session.inputNames[0]]: new Tensor('float32', blob, [n,3,32,32]) })` — but `Tensor` differs between ort-web/ort-node, so accept the tensor constructor via the injected session is awkward; instead build the feed with `ort.Tensor` imported lazily. Simplest: have `classify` receive an already-constructed runner. Use this pattern — the classifier imports nothing from ort; the **caller** supplies a `run(blob, n) => Promise<Float32Array>` closure:

```ts
export type Runner = (blob: Float32Array, n: number) => Promise<Float32Array>; // -> logits length n*13
export class PieceClassifier {
  constructor(private run: Runner) {}
  async classify(crops: SquareImage[]): Promise<SquareLabel[]> {
    if (crops.length === 0) return [];
    const logits = await this.run(preprocess(crops.map((c) => c.image)), crops.length);
    return postprocess(logits, crops.length);
  }
}
/** Build a Runner from an onnxruntime InferenceSession (web or node). Tensor ctor injected. */
export function ortRunner(
  session: InferenceLike,
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown,
): Runner {
  return async (blob, n) => {
    const feeds = { [session.inputNames[0]]: new Tensor('float32', blob, [n, 3, INPUT_SIZE, INPUT_SIZE]) };
    const out = await session.run(feeds);
    return out[session.outputNames[0]].data;
  };
}
```
Then the test constructs `new PieceClassifier(ortRunner(session, ort.Tensor))`. (Update the test's `new PieceClassifier(session as any)` to `new PieceClassifier(ortRunner(session, ort.Tensor))`.)

- [ ] **Step 4: Run to verify it passes** — pure cases + the ≥95% real-crop gate (auto-skips if the model is absent).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/vision/pieces.ts src/tests/pieces.test.ts && git commit -m "feat(vision): pieces.ts hand-rolled bilinear + onnxruntime classifier (port of pieces.py); >=95% real-crop parity (Task ii.5)"
```

---

### Task ii.6: `vision/tracker.ts` — single-frame pipeline (sync, classifier-injected)

**Files:** Create `frontend/src/vision/tracker.ts`, `frontend/src/tests/tracker.test.ts`. **Port `chessmenthol/vision/tracker.py`** MINUS the capturer (capture lives in `lib/capture.ts`). The `Tracker` holds a classifier + `prevFen` + side/orientation overrides; `detectPosition(image)` does detect → cropSquares → classify → bridge to a geometric grid → resolve orientation/side → `assemble`. `classify` is **async** (ort), so `detectPosition` is async.

```ts
export interface ClassifierLike { classify(crops: SquareImage[]): Promise<SquareLabel[]>; }
export class Tracker {
  constructor(classifier: ClassifierLike);
  setSideOverride(white: boolean | null): void;
  setOrientationOverride(o: Orientation | null): void;
  reset(): void;
  detectPosition(image: RgbaImage): Promise<AssembledPosition | null>;
}
```
Port the bridge exactly: name crops with `location.orientationHint`, build `grid[row][col] = labelByName[squareName(col,row,location.orientationHint)]`; resolve `orientation = override ?? hint ?? guessOrientation(grid) ?? 'white_bottom'`; resolve side via the two-pass provisional `assemble` + `guessSideToMove`; final `assemble(grid, {orientation, white, prevFen})`; on legal, update `prevFen`.

- [ ] **Step 1: Write the failing test — port `test_tracker.py` (minus the capturer-delegation case)**

Use a `FakeClassifier` that returns the true label per crop from a known FEN (async). Port: reproduces a known mid-game position (`render_board square=32` so confidence clears the 0.3 gate); returns null on noise; side override honoured; orientation override honoured; infers `e2e4` across two frames (SeqClassifier); propagates a low-confidence square. The Python file is the spec.

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement `vision/tracker.ts`** per the shape + bridge notes.

- [ ] **Step 4: Run to verify it passes** — all ported tracker cases green.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/vision/tracker.ts src/tests/tracker.test.ts && git commit -m "feat(vision): tracker.ts single-frame pipeline (port of tracker.py, capturer split out) (Task ii.6)"
```

---

## Task Group iii — Vision worker + client facade

### Task iii.1: `vision-worker.ts` + `visionClient.ts` (worker wrapper) + `VisionTracker` facade

**Files:** Create `frontend/src/vision/vision-worker.ts`, `frontend/src/vision/visionClient.ts`, `frontend/src/tests/visionClient.test.ts`.

The worker hosts a real ort `Tracker`; the main thread holds the `Capturer` and a `VisionWorkerClient` (promise-per-message). `VisionTracker` is the facade the orchestrator injects: capture (main) → crop (main) → `client.detectPosition(image)` (worker) → `AssembledPosition`; it also forwards overrides/region.

- [ ] **Step 1: Write the failing test for the client + facade (fake worker, mocked capturer)**

```ts
// frontend/src/tests/visionClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import { VisionWorkerClient, VisionTracker } from '../vision/visionClient';
import type { RgbaImage } from '../lib/capture';

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: any[] = [];
  postMessage(msg: any) {
    this.posted.push(msg);
    if (msg.type === 'detect') {
      // echo back a canned AssembledPosition for the request id
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, ok: true, result: { fen: 'X', isLegal: true, status: 'valid', lowConfidence: [], move: null, orientation: 'white_bottom', sideToMove: 'white' } } } as MessageEvent));
    }
  }
  terminate() {}
}

describe('VisionWorkerClient', () => {
  it('resolves detectPosition with the worker result for the matching id', async () => {
    const w = new FakeWorker();
    const client = new VisionWorkerClient(w as unknown as Worker);
    const img: RgbaImage = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const res = await client.detectPosition(img);
    expect(res?.fen).toBe('X');
    expect(w.posted.find((m) => m.type === 'detect')).toBeTruthy();
  });
});

describe('VisionTracker facade', () => {
  it('captures, crops to the region, and forwards the crop to the worker', async () => {
    const w = new FakeWorker();
    const client = new VisionWorkerClient(w as unknown as Worker);
    const capturer = {
      setRegion: vi.fn(),
      grab: vi.fn(async () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
      grabFullDesktop: vi.fn(async () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 })),
    };
    const tracker = new VisionTracker(capturer as any, client);
    const ap = await tracker.detectPosition();
    expect(ap?.fen).toBe('X');
    expect(capturer.grab).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (modules missing).

- [ ] **Step 3: Implement `vision/visionClient.ts`**

```ts
// frontend/src/vision/visionClient.ts
import type { RgbaImage } from '../lib/capture';
import type { Capturer } from '../lib/capture';
import type { Region } from '../lib/region';
import type { AssembledPosition } from './position';
import type { Orientation } from './types';

type Pending = { resolve: (v: AssembledPosition | null) => void; reject: (e: unknown) => void };

/** Promise-per-message wrapper over the vision worker. */
export class VisionWorkerClient {
  private seq = 0;
  private pending = new Map<number, Pending>();
  constructor(private worker: Worker) {
    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ok, result, error } = e.data as { id: number; ok: boolean; result?: AssembledPosition | null; error?: string };
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      ok ? p.resolve(result ?? null) : p.reject(new Error(error));
    };
  }
  detectPosition(image: RgbaImage): Promise<AssembledPosition | null> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // transfer the pixel buffer to avoid a copy
      this.worker.postMessage({ id, type: 'detect', image }, [image.data.buffer]);
    });
  }
  setSideOverride(white: boolean | null): void { this.worker.postMessage({ type: 'setSideOverride', white }); }
  setOrientationOverride(o: Orientation | null): void { this.worker.postMessage({ type: 'setOrientationOverride', orientation: o }); }
  reset(): void { this.worker.postMessage({ type: 'reset' }); }
}

/** The tracker facade the orchestrator injects: capture (main) + detect (worker). */
export class VisionTracker {
  constructor(private capturer: Capturer, private client: VisionWorkerClient) {}
  setRegion(region: Region | null): void { this.capturer.setRegion(region); }
  setSideOverride(white: boolean | null): void { this.client.setSideOverride(white); }
  setOrientationOverride(o: Orientation | null): void { this.client.setOrientationOverride(o); }
  reset(): void { this.client.reset(); }
  async grabFullDesktop(): Promise<RgbaImage> { return this.capturer.grabFullDesktop(); }
  async detectPosition(): Promise<AssembledPosition | null> {
    const image = await this.capturer.grab();
    return this.client.detectPosition(image);
  }
}
```

- [ ] **Step 4: Implement `vision/vision-worker.ts`** (the thin worker shell)

```ts
// frontend/src/vision/vision-worker.ts
import * as ort from 'onnxruntime-web';
import { Tracker } from './tracker';
import { PieceClassifier, ortRunner } from './pieces';
import type { RgbaImage } from '../lib/capture';
import type { Orientation } from './types';

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1; // tiny CNN; no SAB dependency

let trackerPromise: Promise<Tracker> | null = null;
function getTracker(): Promise<Tracker> {
  if (!trackerPromise) {
    trackerPromise = ort.InferenceSession
      .create('/models/pieces.onnx', { executionProviders: ['wasm'] })
      .then((session) => new Tracker(new PieceClassifier(ortRunner(session, ort.Tensor))));
  }
  return trackerPromise;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { id: number; type: 'detect'; image: RgbaImage }
    | { type: 'setSideOverride'; white: boolean | null }
    | { type: 'setOrientationOverride'; orientation: Orientation | null }
    | { type: 'reset' };
  const tracker = await getTracker();
  if (msg.type === 'setSideOverride') return void tracker.setSideOverride(msg.white);
  if (msg.type === 'setOrientationOverride') return void tracker.setOrientationOverride(msg.orientation);
  if (msg.type === 'reset') return void tracker.reset();
  if (msg.type === 'detect') {
    try {
      const result = await tracker.detectPosition(msg.image);
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result });
    } catch (err) {
      (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: String(err) });
    }
  }
};
```
> The worker is instantiated by the engine client (Group v) as `new Worker(new URL('../vision/vision-worker.ts', import.meta.url), { type: 'module' })`. Worker code is exercised end-to-end in Group vi; the message protocol + facade are unit-tested here via the fake worker.

- [ ] **Step 5: Run to verify the client/facade tests pass** — `cd frontend && npx vitest run src/tests/visionClient.test.ts` → PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && git add src/vision/visionClient.ts src/vision/vision-worker.ts src/tests/visionClient.test.ts && git commit -m "feat(vision): vision worker + client + VisionTracker facade (Task iii.1)"
```

---

## Task Group iv — Wire the orchestrator + region-shot serialize

### Task iv.1: `core/serialize.ts` — `regionShotToDict` (TS JPEG encode)

**Files:** Modify `frontend/src/core/serialize.ts`, `frontend/src/tests/serialize.test.ts`. Port `serialize.py::region_shot_to_dict`: downscale to ≤2560 width, JPEG q80, base64, return **true** desktop dims. Use `OffscreenCanvas` (available in the renderer + worker; in jsdom tests it is absent, so the function takes an injectable encoder and the unit test asserts the dimension math with a fake encoder).

- [ ] **Step 1: Write the failing test (append to `serialize.test.ts`)**

```ts
import { regionShotToDict } from '../core/serialize';

describe('regionShotToDict', () => {
  it('reports TRUE dims and downscales the encoded canvas past 2560 width', async () => {
    const calls: Array<{ w: number; h: number }> = [];
    const fakeEncode = async (w: number, h: number) => { calls.push({ w, h }); return 'BASE64'; };
    const shot = await regionShotToDict({ data: new Uint8ClampedArray(4), width: 5120, height: 2880 }, fakeEncode);
    expect(shot.type).toBe('region_shot');
    expect(shot.width).toBe(5120);   // true dims, not downscaled
    expect(shot.height).toBe(2880);
    expect(calls[0].w).toBe(2560);   // encoded at half scale
    expect(calls[0].h).toBe(1440);
    expect(shot.jpegBase64).toBe('BASE64');
  });
  it('does not upscale a small image', async () => {
    const calls: Array<{ w: number; h: number }> = [];
    await regionShotToDict({ data: new Uint8ClampedArray(4), width: 800, height: 600 }, async (w, h) => { calls.push({ w, h }); return ''; });
    expect(calls[0]).toEqual({ w: 800, h: 600 });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`regionShotToDict` missing).

- [ ] **Step 3: Implement `regionShotToDict` in `core/serialize.ts`**

```ts
import type { RgbaImage } from '../lib/capture';
import type { RegionShotFrame } from '../lib/types';

export type JpegEncoder = (width: number, height: number, scaledFrom: RgbaImage) => Promise<string>; // -> base64 (no data: prefix)

/** Default encoder: draw the (already-decided) scaled size via OffscreenCanvas, JPEG q80. */
export async function offscreenJpegEncoder(width: number, height: number, src: RgbaImage): Promise<string> {
  const srcCanvas = new OffscreenCanvas(src.width, src.height);
  srcCanvas.getContext('2d')!.putImageData(new ImageData(src.data, src.width, src.height), 0, 0);
  const dst = new OffscreenCanvas(width, height);
  const ctx = dst.getContext('2d')!;
  ctx.drawImage(srcCanvas, 0, 0, width, height);
  const blob = await dst.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

const MAX_WIDTH = 2560;

export async function regionShotToDict(image: RgbaImage, encode: JpegEncoder = offscreenJpegEncoder): Promise<RegionShotFrame> {
  const scale = Math.min(1, MAX_WIDTH / image.width);
  const w = scale >= 1 ? image.width : Math.max(1, Math.round(image.width * scale));
  const h = scale >= 1 ? image.height : Math.max(1, Math.round(image.height * scale));
  return {
    type: 'region_shot',
    jpegBase64: await encode(w, h, image),
    width: image.width,   // TRUE dims
    height: image.height,
  };
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/core/serialize.ts src/tests/serialize.test.ts && git commit -m "feat(core): regionShotToDict TS JPEG encode (port of serialize.region_shot_to_dict) (Task iv.1)"
```

---

### Task iv.2: `core/orchestrator.ts` — real vision handlers + state

**Files:** Modify `frontend/src/core/orchestrator.ts`, `frontend/src/tests/orchestrator.test.ts`. Replace the inert vision switch with real async handlers driving an **injected tracker facade** (so non-Tauri builds inject nothing and behaviour is unchanged). Port `server/orchestrator.py` vision methods (`_capture_now`, `_request_region_shot`, `_set_region`, `_clear_region`, `_apply_detection`) + `set_turn` side-override + `_state_frame` vision fields.

- [ ] **Step 1: Define the injected tracker seam + vision state**

Add to `OrchestratorOptions` and the class:
```ts
// the subset of VisionTracker the orchestrator needs (async); injected only under Tauri.
export interface VisionTrackerLike {
  detectPosition(): Promise<AssembledPosition | null>;
  grabFullDesktop(): Promise<RgbaImage>;
  setRegion(region: { left: number; top: number; width: number; height: number } | null): void;
  setSideOverride(white: boolean | null): void;
  setOrientationOverride(o: 'white_bottom' | 'black_bottom' | null): void;
  reset(): void;
}
```
(`OrchestratorOptions.tracker?: VisionTrackerLike`; store as `_tracker: VisionTrackerLike | null`.) Add vision state fields: `_visionStatus: 'idle'|'found'|'low_confidence'|'no_board' = 'idle'`, `_detectedOrientation: 'white'|'black'|null = null`, `_lowConfidence: string[] = []`, `_region: {...}|null = null`. Import `regionShotToDict` from `./serialize`, `boardFenOf`/`posFromFen` from `./chess`, and the `AssembledPosition`/`RgbaImage` types.

- [ ] **Step 2: Write the failing tests (port the vision-relevant `test_orchestrator.py` cases with a fake tracker)**

```ts
// add to orchestrator.test.ts
import type { VisionTrackerLike } from '../core/orchestrator';

function fakeTracker(over: Partial<VisionTrackerLike> = {}): VisionTrackerLike {
  return {
    detectPosition: async () => null,
    grabFullDesktop: async () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    setRegion: () => {}, setSideOverride: () => {}, setOrientationOverride: () => {}, reset: () => {},
    ...over,
  };
}

describe('orchestrator — vision', () => {
  it('set_region validates, stores the region, and triggers a capture that applies a detected placement', async () => {
    const frames: any[] = [];
    const detected = { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', isLegal: true, status: 'valid', lowConfidence: [], move: null, orientation: 'white_bottom' as const, sideToMove: 'white' as const };
    const tracker = fakeTracker({ detectPosition: async () => ({ ...detected, fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', isLegal: true, lowConfidence: ['e4'] }) });
    const orch = new Orchestrator((f) => frames.push(f), { engine: fakeEngine(), tracker });
    orch.handle({ type: 'set_region', left: 10, top: 20, width: 100, height: 100 });
    await flush(); // let the async capture resolve
    const last = frames.at(-1);
    expect(last.region).toEqual({ left: 10, top: 20, width: 100, height: 100 });
    expect(last.visionStatus).toBe('low_confidence');
    expect(last.lowConfidence).toEqual(['e4']);
    expect(last.detectedOrientation).toBe('white');
  });

  it('set_region rejects a non-positive rectangle', () => {
    const frames: any[] = [];
    const orch = new Orchestrator((f) => frames.push(f), { engine: fakeEngine(), tracker: fakeTracker() });
    orch.handle({ type: 'set_region', left: -1, top: 0, width: 0, height: 5 });
    expect(frames.at(-1).type).toBe('error');
  });

  it('capture_now with no board -> visionStatus no_board', async () => {
    const frames: any[] = [];
    const orch = new Orchestrator((f) => frames.push(f), { engine: fakeEngine(), tracker: fakeTracker({ detectPosition: async () => null }) });
    orch.handle({ type: 'capture_now' });
    await flush();
    expect(frames.at(-1).visionStatus).toBe('no_board');
  });

  it('request_region_shot emits a region_shot frame', async () => {
    const frames: any[] = [];
    const tracker = fakeTracker({ grabFullDesktop: async () => ({ data: new Uint8ClampedArray(800 * 600 * 4), width: 800, height: 600 }) });
    const orch = new Orchestrator((f) => frames.push(f), { engine: fakeEngine(), tracker });
    orch.handle({ type: 'request_region_shot' });
    await flush();
    expect(frames.at(-1).type).toBe('region_shot');
    expect(frames.at(-1).width).toBe(800);
  });

  it('clear_region resets region + status and forwards to the tracker', () => {
    const frames: any[] = [];
    const setRegion = vi.fn();
    const orch = new Orchestrator((f) => frames.push(f), { engine: fakeEngine(), tracker: fakeTracker({ setRegion }) });
    orch.handle({ type: 'clear_region' });
    expect(frames.at(-1).region).toBeNull();
    expect(frames.at(-1).visionStatus).toBe('idle');
    expect(setRegion).toHaveBeenCalledWith(null);
  });

  it('set_turn forwards a side override to the tracker', () => {
    const setSideOverride = vi.fn();
    const orch = new Orchestrator(() => {}, { engine: fakeEngine(), tracker: fakeTracker({ setSideOverride }) });
    orch.handle({ type: 'set_turn', white: false });
    expect(setSideOverride).toHaveBeenCalledWith(false);
  });
});
```
> Provide a `flush()` helper in the test file: `const flush = () => new Promise((r) => setTimeout(r, 0));` and reuse the existing `fakeEngine()`/`vi` imports. The detected-placement test expects `_applyDetection` to call `_applyFen` (placement differs from the start board), so the frame reflects the detected FEN.

- [ ] **Step 3: Run to verify it fails** — FAIL (handlers still inert / `tracker` option unknown).

- [ ] **Step 4: Implement the handlers** — replace the inert switch in `handle()` and add the methods:

```ts
// in handle(): remove the inert vision case block; route to async methods (fire-and-forget;
// each method catches + emits its own error/state frame).
switch (cmd.type) {
  case 'capture_now': void this._captureNow(); return;
  case 'request_region_shot': void this._requestRegionShot(); return;
  case 'set_region': this._setRegion(cmd); return;
  case 'clear_region': this._clearRegion(); return;
}
// ...existing try/switch for the rest...
```
```ts
private async _captureNow(): Promise<void> {
  if (this._tracker === null) { this._send(this._stateFrame(this._lastAnalysis)); return; }
  let assembled: AssembledPosition | null;
  try {
    assembled = await this._tracker.detectPosition();
  } catch (exc) {
    this._visionStatus = 'no_board';
    this._error(`capture failed: ${exc instanceof Error ? exc.message : String(exc)}`);
    return;
  }
  this._applyDetection(assembled);
}

private async _requestRegionShot(): Promise<void> {
  if (this._tracker === null) { this._send(this._stateFrame(this._lastAnalysis)); return; }
  try {
    const image = await this._tracker.grabFullDesktop();
    this._send(await regionShotToDict(image));
  } catch (exc) {
    this._error(`screen capture unavailable: ${exc instanceof Error ? exc.message : String(exc)}`);
  }
}

private _setRegion(cmd: { left: number; top: number; width: number; height: number }): void {
  const left = Number(cmd.left), top = Number(cmd.top), width = Number(cmd.width), height = Number(cmd.height);
  if ([left, top, width, height].some((n) => !Number.isFinite(n))) { this._error('invalid region'); return; }
  if (width <= 0 || height <= 0 || left < 0 || top < 0) { this._error('invalid region: must be positive and on-screen'); return; }
  const region = { left, top, width, height };
  this._region = region;
  this._tracker?.setRegion(region);
  void this._captureNow();
}

private _clearRegion(): void {
  this._region = null;
  this._visionStatus = 'idle';
  this._tracker?.setRegion(null);
  this._send(this._stateFrame(this._lastAnalysis));
}

private _applyDetection(assembled: AssembledPosition | null): void {
  if (assembled === null || !assembled.isLegal) {
    this._visionStatus = 'no_board';
    this._send(this._stateFrame(this._lastAnalysis));
    return;
  }
  this._detectedOrientation = assembled.orientation === 'black_bottom' ? 'black' : 'white';
  this._lowConfidence = [...assembled.lowConfidence];
  this._visionStatus = assembled.lowConfidence.length ? 'low_confidence' : 'found';
  // placement-only comparison (a screenshot can't read turn/castling/ep reliably)
  if (assembled.fen.split(' ')[0] !== boardFenOf(this._board)) {
    this._applyFen(assembled.fen);
  } else {
    this._send(this._stateFrame(this._lastAnalysis));
  }
}
```
Wire `set_turn` to forward the override (append at the end of `setTurn`, after the existing body): `this._tracker?.setSideOverride(white);`. In the constructor, set `this._tracker = opts.tracker ?? null;`. In `_stateFrame`, replace the four inert vision defaults with the live fields:
```ts
      visionStatus: this._visionStatus,
      detectedOrientation: this._detectedOrientation,
      lowConfidence: this._lowConfidence,
      region: this._region,
```

- [ ] **Step 5: Run to verify it passes** — `cd frontend && npx vitest run src/tests/orchestrator.test.ts` → PASS (existing + new vision cases). Confirm `_applyDetection`'s placement-compare path uses `boardFenOf`.

- [ ] **Step 6: Typecheck + commit**

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && git add src/core/orchestrator.ts src/tests/orchestrator.test.ts && git commit -m "feat(core): real async vision handlers + state in orchestrator (port of orchestrator.py vision) (Task iv.2)"
```

---

## Task Group v — Flip the UI on under Tauri

### Task v.1: `lib/engineClient.ts` — construct + inject `VisionTracker` when in Tauri

**Files:** Modify `frontend/src/lib/engineClient.ts`, `frontend/src/tests/engineClient.test.ts`.

- [ ] **Step 1: Build the tracker only inside Tauri, inject it into the orchestrator**

Add near the orchestrator construction:
```ts
import { Capturer, hasNativeCapture } from './capture';
import { VisionWorkerClient, VisionTracker } from '../vision/visionClient';

function makeVisionTracker(): VisionTracker | undefined {
  if (!hasNativeCapture()) return undefined; // pure-web: analysis-only
  const worker = new Worker(new URL('../vision/vision-worker.ts', import.meta.url), { type: 'module' });
  return new VisionTracker(new Capturer(), new VisionWorkerClient(worker));
}

const orch = new Orchestrator(applyFrame, {
  engine: engineController,
  sessionFactory: (_engine, cb) => new LazySession(engineController, cb),
  tracker: makeVisionTracker(),
});
```
The `regionShot` store + `applyFrame`'s `region_shot` routing already exist (Phase 1b), so no other client changes are needed.

- [ ] **Step 2: Update the client test** — assert that in the test (jsdom, non-Tauri) `hasNativeCapture()` is false so no worker is created and the app still constructs (the existing engineClient tests must still pass). Run: `cd frontend && npx vitest run src/tests/engineClient.test.ts` → PASS.

- [ ] **Step 3: Typecheck + commit**

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && git add src/lib/engineClient.ts src/tests/engineClient.test.ts && git commit -m "feat(client): inject VisionTracker into the orchestrator when running in Tauri (Task v.1)"
```

---

### Task v.2: `App.svelte` — `hasCapture` + orientation/low-confidence parity

**Files:** Modify `frontend/src/App.svelte`.

- [ ] **Step 1: Flip `hasCapture` to runtime Tauri detection**

```svelte
  import { hasNativeCapture } from './lib/capture';
  const hasCapture = hasNativeCapture(); // true inside Tauri; false in a plain browser
```
(Replaces `const hasCapture = false;`.) `SourceControls`, `RegionOverlay`, `regionShot`, and `onPickRegion`/`onConfirmRegion` are already wired (Phase 1b) and now activate.

- [ ] **Step 2: Auto-follow detected orientation + show low-confidence squares**

Match the current app's behavior: when `s?.detectedOrientation` is set and the user hasn't manually flipped, set the board `orientation` from it; pass `s?.lowConfidence` to the board so uncertain squares render their existing badge/highlight. Use the already-present `manualFlip` guard:
```svelte
  $: if (s?.detectedOrientation && !manualFlip) orientation = s.detectedOrientation;
```
Confirm the `Board`/`BoardBadge` props for low-confidence already exist from M4c parity (they were ported in Phase 1b's UI); if a prop is missing, pass `lowConfidence={s?.lowConfidence ?? []}` to `Board`.

- [ ] **Step 3: Typecheck + commit**

```bash
cd frontend && npm run check && git add src/App.svelte && git commit -m "feat(client): enable vision UI under Tauri; auto-follow detected orientation (Task v.2)"
```

---

## Task Group vi — Verify parity

### Task vi.1: Full suite + typecheck + Rust build

- [ ] **Step 1: Run everything**

```bash
cd frontend && npm run test && npx tsc -p tsconfig.app.json --noEmit && (cd src-tauri && cargo build)
```
Expected: all Vitest suites green (capture, detect, position, pieces ≥95%, tracker, visionClient, serialize, orchestrator vision, plus all pre-existing Phase 1b suites); typecheck clean; `cargo build` succeeds. The `pieces` real-crop test runs under onnxruntime-node; the worker/ort-web path is verified manually in vi.2.

### Task vi.2: Manual parity check inside `tauri dev`

- [ ] **Step 1: Launch the desktop app**

```bash
cd frontend && npm run tauri dev
```

- [ ] **Step 2: Walk the parity contract** (with a chess board visible on screen, e.g. a lichess/chess.com board in a browser window):
  - Click **Select Region** → the full-desktop screenshot overlay appears (the `region_shot` JPEG). On Wayland, accept the one-time portal prompt.
  - Drag a box around the on-screen board, **Use region** → the board updates to the detected position; **Capture Board** becomes enabled.
  - Detected **orientation** flips the board if black-on-bottom; **uncertain** squares show the low-confidence badge; the **Source** status shows `N uncertain` / `Board Undetected` appropriately.
  - Click **Capture Board** again after moving a piece on screen → the position follows (placement-only); the move is classified once analysis is on (depth ≥ 8).
  - **Clear Selection** → region clears, status returns to idle, full-frame capture restored.
  - Toggle analysis: eval bar + multi-PV lines stream (stockfish.wasm threads available via the Tauri COOP/COEP headers); play/undo/navigate/reset unaffected.

- [ ] **Step 3: Confirm graceful degradation** — `cd frontend && npm run dev` (plain browser): the vision controls are hidden (`hasCapture` false), analysis still works, no capture errors in the console.

- [ ] **Step 4: Note results** in the commit / PR description (what was verified, any platform-specific observations — esp. Wayland portal behavior).

---

## Self-Review

**Spec coverage (§6 vision flow, §2.1 parity contract):**
- Rust `grab_*` capture (raw RGBA) → Task i.2; JS wrapper → i.3. ✓
- `detect`/`pieces`/`tracker`/`position` ports → Group ii (golden-fixture parity gates ported from `tests/vision/*` + `test_position.py`). ✓
- onnxruntime-web inference in a Web Worker → Group iii; hand-rolled bilinear (chosen decision) → ii.5. ✓
- Four vision commands + `visionStatus`/`detectedOrientation`/`lowConfidence`/`region` + placement-only apply + `set_turn` override → iv.2 (ported from `orchestrator.py`). ✓
- `region_shot` JPEG (downscale ≤2560, q80, true dims) → iv.1 (ported from `serialize.py`). ✓
- Region overlay → `set_region` UX (already wired) re-enabled → v.1/v.2; Tauri COOP/COEP for SAB → i.1. ✓
- Degrade to analysis-only outside Tauri → v.1/v.2 (`hasNativeCapture()` gate). ✓
- Scope boundary respected: `tauri build` bundle targets + CI matrix + Python deletion are **Phase 3** (not here). ✓

**Decisions locked (brainstorming):** raw RGBA over IPC (i.2/i.3, `tauri::ipc::Response` header+bytes); vision pipeline in a dedicated Web Worker (iii.1, pure modules tested directly); hand-rolled OpenCV `INTER_LINEAR` (ii.5). ✓

**Placeholder scan:** novel glue (Rust capture, worker, ort runner, bilinear, capture wrapper, `assembleFromGrid`, serialize, orchestrator handlers, facade) is given as complete code. Faithful-port tasks (detect/position/pieces/tracker) name the committed Python as the line-by-line spec and require porting its pytest cases — the repo convention from Phase 1b, not a placeholder. ✓

**Type consistency:** `RgbaImage` (`lib/capture.ts`) flows through `detect`/`pieces`/`position`/`tracker`/worker/`serialize`. `AssembledPosition` is plain data (worker-cloneable) and consumed by `orchestrator._applyDetection`. `VisionTrackerLike` (orchestrator seam) is satisfied by `VisionTracker` (facade). `Runner`/`InferenceLike` decouple `pieces.ts` from ort-web vs ort-node. `boardFenOf` is the placement-compare primitive in both `position.inferMove` and `orchestrator._applyDetection`. ✓

**Risk:** `detect.ts` (ii.2) is the parity-critical port — grayscale rounding + reflect-101 Sobel border are the usual culprits; the synthetic + 4 real fixtures gate it. `pieces.ts` resize parity is removed as a variable by the hand-rolled bilinear; the ≥95% real-crop gate confirms it. The worker/ort-web path has no automated gate (jsdom can't run it) — vi.2 is its manual gate.
