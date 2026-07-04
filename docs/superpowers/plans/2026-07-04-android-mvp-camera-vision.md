# Android MVP — Camera Capture + Perspective Warp + Vision Integration (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Android MVP: photograph a screen showing a chess.com/lichess board, straighten it, read the position with the existing vision pipeline, and analyze it with the (already-working) native engine — Home → Camera → warp → vision → Edit → Analysis.

**Architecture:** A `CameraCapturer` (getUserMedia → still frame → `RgbaImage`) feeds a new pure-TS perspective-warp stage (`vision/warp.ts`) that homography-maps a 4-corner quad to a clean axis-aligned square, which the unchanged `detect → pieces → position` worker pipeline then reads. A `CameraOverlay` component provides the live preview, capture, and 4-corner tap UI (the mobile analog of `RegionOverlay`).

**Tech Stack:** Svelte 5 (legacy API), TypeScript, getUserMedia/canvas, the existing `onnxruntime-web` vision worker, Vitest.

---

## Validated constraints (from Plan 1's on-device spikes — do NOT re-litigate)

- **ORT works without SAB.** The Android WebView is not cross-origin isolated (`crossOriginIsolated=false`, no `SharedArrayBuffer`), but `onnxruntime-web` at `numThreads=1` (the app's existing config) instantiates `pieces.onnx` fine. **No COOP/COEP work needed.**
- **The full worker pipeline runs on-device** (detect → pieces → position → FEN).
- **The warp/crop is the make-or-break for FEN correctness.** A raw, uncropped screenshot produced garbage; the model (`pieces.test.ts`: `/255` NCHW crops) needs a clean, correctly-cropped, axis-aligned square board. This plan's `warp.ts` is that step.
- **Canvas is the image path** (camera → canvas → `RgbaImage`). Use `createImageBitmap(blob, { colorSpaceConversion: 'none' })` / `getContext('2d')` carefully to preserve pixel fidelity; `HTMLImageElement.decode()` proved flaky in the WebView — prefer `createImageBitmap`.

## Scope (MVP)

**In:** manual 4-corner-tap warp (reliable baseline), camera capture, the camera overlay, and the mobile snap→analyze flow wired end to end.

**Out (fast-follow, not MVP):** automatic quad detection (the manual tap is the MVP; auto-detect becomes an enhancement with the manual as fallback), extra ABIs, net-size reduction.

**Verification tiers** (as in Plan 1): `[HERE]` = Vitest/host; `[DEVICE]` = on the Pixel 9. Build/install: `NDK_HOME=/home/buga/Android/Sdk/ndk/27.1.12297006 npx tauri android build --apk --debug -t aarch64` (from `app/`), `adb install -r`.

---

## Task 1: `vision/warp.ts` — homography warp of a 4-corner quad to a square (TDD, [HERE])

Pure TS, fully unit-tested — the host-verifiable centerpiece.

**Files:**
- Create: `app/src/vision/warp.ts`
- Test: `app/src/tests/warp.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/tests/warp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeHomography, warpQuadToSquare, type Point } from '../vision/warp';
import type { RgbaImage } from '../lib/capture';

function solid(w: number, h: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i*4]=rgb[0]; data[i*4+1]=rgb[1]; data[i*4+2]=rgb[2]; data[i*4+3]=255; }
  return { data, width: w, height: h };
}
// A 2x2 colour blocks image (TL red, TR green, BL blue, BR white).
function quad2x2(n: number): RgbaImage {
  const img = solid(n, n, [0, 0, 0]);
  const put = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * n + x) * 4; img.data[i]=c[0]; img.data[i+1]=c[1]; img.data[i+2]=c[2]; img.data[i+3]=255;
    }
  };
  const h = n / 2;
  put(0,0,h,h,[255,0,0]); put(h,0,n,h,[0,255,0]); put(0,h,h,n,[0,0,255]); put(h,h,n,n,[255,255,255]);
  return img;
}
const px = (img: RgbaImage, x: number, y: number) =>
  [img.data[(y*img.width+x)*4], img.data[(y*img.width+x)*4+1], img.data[(y*img.width+x)*4+2]];

describe('computeHomography', () => {
  it('maps the four source points onto the four destination points', () => {
    const from: [Point,Point,Point,Point] = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
    const to: [Point,Point,Point,Point]   = [{x:2,y:3},{x:22,y:1},{x:24,y:21},{x:1,y:19}];
    const H = computeHomography(from, to);
    for (let i = 0; i < 4; i++) {
      const p = from[i];
      const w = H[6]*p.x + H[7]*p.y + H[8];
      const x = (H[0]*p.x + H[1]*p.y + H[2]) / w;
      const y = (H[3]*p.x + H[4]*p.y + H[5]) / w;
      expect(x).toBeCloseTo(to[i].x, 4);
      expect(y).toBeCloseTo(to[i].y, 4);
    }
  });
});

describe('warpQuadToSquare', () => {
  it('identity: a square quad over the whole image warps to (near) itself', () => {
    const src = quad2x2(16);
    const out = warpQuadToSquare(src, [{x:0,y:0},{x:16,y:0},{x:16,y:16},{x:0,y:16}], 16);
    expect(out.width).toBe(16); expect(out.height).toBe(16);
    expect(px(out, 2, 2)).toEqual([255,0,0]);      // TL red
    expect(px(out, 13, 2)).toEqual([0,255,0]);     // TR green
    expect(px(out, 2, 13)).toEqual([0,0,255]);     // BL blue
    expect(px(out, 13, 13)).toEqual([255,255,255]);// BR white
  });

  it('straightens a rotated/skewed quad into an axis-aligned square', () => {
    // Source: a bigger canvas whose 2x2 block region is a skewed quad.
    const src = solid(40, 40, [0,0,0]);
    const blocks = quad2x2(40);
    // paint the 2x2 blocks only inside a skewed quad by warping FROM the square blocks?
    // Simpler: warp the whole 40x40 blocks image via a known quad and assert corners.
    const quad: [Point,Point,Point,Point] = [{x:5,y:2},{x:38,y:6},{x:34,y:37},{x:2,y:33}];
    const out = warpQuadToSquare(blocks, quad, 20);
    // The four block colours must still land in their corners after straightening.
    expect(px(out, 3, 3)[0]).toBeGreaterThan(200);   // TL red-ish (R high)
    expect(px(out, 16, 3)[1]).toBeGreaterThan(200);  // TR green-ish (G high)
    expect(px(out, 3, 16)[2]).toBeGreaterThan(200);  // BL blue-ish (B high)
    expect(px(out, 16, 16).every((c) => c > 200)).toBe(true); // BR white
  });
});
```

- [ ] **Step 2: Run to verify it fails — [HERE]**

Run: `cd app && npx vitest run src/tests/warp.test.ts`
Expected: FAIL — `../vision/warp` does not exist.

- [ ] **Step 3: Implement `warp.ts`**

`app/src/vision/warp.ts`:

```ts
// app/src/vision/warp.ts
// Perspective-warp a 4-corner quad (in a source RGBA image) to a clean axis-aligned
// N×N square, so a hand-held photo of a board becomes the pixel-perfect input the
// detect→pieces pipeline expects. Pure TS (no OpenCV), inverse-mapped + bilinear.
import type { RgbaImage } from '../lib/capture';

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // TL, TR, BR, BL

/** 3×3 homography (row-major, 9 elems) mapping the 4 `from` points to `to`.
 *  Solves the 8×8 linear system for h11..h32 with h33 fixed to 1. */
export function computeHomography(from: Quad, to: Quad): number[] {
  // Build A·h = b where h = [h11 h12 h13 h21 h22 h23 h31 h32].
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
  }
  const h = solve8(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting for an 8×8 system. */
function solve8(A: number[][], b: number[]): number[] {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/** Warp the `quad` region of `src` into a `size`×`size` axis-aligned square.
 *  Inverse map: for each dest pixel, sample the source via the square→quad homography. */
export function warpQuadToSquare(src: RgbaImage, quad: Quad, size: number): RgbaImage {
  const square: Quad = [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }];
  const H = computeHomography(square, quad); // dest(square) -> source(quad)
  const out = new Uint8ClampedArray(size * size * 4);
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const w = H[6] * u + H[7] * v + H[8];
      const sx = (H[0] * u + H[1] * v + H[2]) / w;
      const sy = (H[3] * u + H[4] * v + H[5]) / w;
      sampleBilinear(src, sx, sy, out, (v * size + u) * 4);
    }
  }
  return { data: out, width: size, height: size };
}

/** Bilinear sample src at (x,y), writing RGBA into out[o..o+3]. Clamps to edges. */
function sampleBilinear(src: RgbaImage, x: number, y: number, out: Uint8ClampedArray, o: number): void {
  const { data, width, height } = src;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const cx0 = Math.max(0, Math.min(width - 1, x0)), cx1 = Math.max(0, Math.min(width - 1, x0 + 1));
  const cy0 = Math.max(0, Math.min(height - 1, y0)), cy1 = Math.max(0, Math.min(height - 1, y0 + 1));
  for (let c = 0; c < 4; c++) {
    const p00 = data[(cy0 * width + cx0) * 4 + c], p10 = data[(cy0 * width + cx1) * 4 + c];
    const p01 = data[(cy1 * width + cx0) * 4 + c], p11 = data[(cy1 * width + cx1) * 4 + c];
    const top = p00 + (p10 - p00) * fx, bot = p01 + (p11 - p01) * fx;
    out[o + c] = top + (bot - top) * fy;
  }
}
```

- [ ] **Step 4: Run to verify it passes — [HERE]**

Run: `cd app && npx vitest run src/tests/warp.test.ts`
Expected: PASS (both describes).

- [ ] **Step 5: Full suite + type-check — [HERE]**

Run: `cd app && npm test && npm run check`
Expected: full suite green (+ new warp tests), check 0/0.

- [ ] **Step 6: Commit**

```bash
git add app/src/vision/warp.ts app/src/tests/warp.test.ts
git commit -m "feat(vision): pure-TS homography warp of a 4-corner quad to a square

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `lib/camera.ts` — `CameraCapturer` (getUserMedia → RgbaImage)

A capture source mirroring `Capturer`'s shape so the orchestrator is source-agnostic.

**Files:**
- Create: `app/src/lib/camera.ts`
- Test: `app/src/tests/camera.test.ts`

- [ ] **Step 1: Write the failing test (pure helper — frame → RgbaImage)**

The device-only `getUserMedia` part is not unit-tested; the pixel extraction is. `app/src/tests/camera.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { frameToRgba } from '../lib/camera';

describe('frameToRgba', () => {
  it('reads canvas ImageData into an RgbaImage of the source size', () => {
    // A fake canvas-like source: 2x2, filled via a stub drawImage/getImageData.
    const fakeCtx = {
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([1,2,3,255, 4,5,6,255, 7,8,9,255, 10,11,12,255]), width: 2, height: 2 }),
    };
    const fakeCanvas = { width: 0, height: 0, getContext: () => fakeCtx } as unknown as HTMLCanvasElement;
    const src = { width: 2, height: 2 } as unknown as CanvasImageSource & { width: number; height: number };
    const img = frameToRgba(src, fakeCanvas);
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(Array.from(img.data.slice(0, 4))).toEqual([1,2,3,255]);
  });
});
```

- [ ] **Step 2: Run to verify it fails — [HERE]**

Run: `cd app && npx vitest run src/tests/camera.test.ts`
Expected: FAIL — `../lib/camera` does not exist.

- [ ] **Step 3: Implement `camera.ts`**

`app/src/lib/camera.ts`:

```ts
// app/src/lib/camera.ts
// Mobile capture source: a still frame from the device camera via getUserMedia, read
// into the same RgbaImage the vision pipeline consumes. Pixel fidelity matters (the
// piece model is /255-normalized), so we read the canvas straight with no smoothing.
import type { RgbaImage } from './capture';

/** Extract RGBA pixels from a drawable source (video frame / ImageBitmap) via a canvas. */
export function frameToRgba(
  source: CanvasImageSource & { width: number; height: number },
  canvas: HTMLCanvasElement = document.createElement('canvas'),
): RgbaImage {
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: new Uint8ClampedArray(d.data), width: d.width, height: d.height };
}

/** Opens the rear camera, exposes the live <video>, and grabs a still RgbaImage. */
export class CameraCapturer {
  private stream: MediaStream | null = null;
  constructor(private video: HTMLVideoElement) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  /** Capture the current frame as an RgbaImage (natural video resolution). */
  grab(): RgbaImage {
    const src = Object.assign(this.video, {
      width: this.video.videoWidth,
      height: this.video.videoHeight,
    });
    return frameToRgba(src as unknown as CanvasImageSource & { width: number; height: number });
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
```

- [ ] **Step 4: Run to verify it passes + check — [HERE]**

Run: `cd app && npx vitest run src/tests/camera.test.ts && npm run check`
Expected: PASS, 0/0.

- [ ] **Step 5: Android CAMERA permission**

Add to `app/src-tauri/gen/android/app/src/main/AndroidManifest.xml` (before `<application>`):

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera.any" android:required="false" />
```

The Tauri WebView must also grant the runtime prompt; verify on-device in Task 5.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/camera.ts app/src/tests/camera.test.ts app/src-tauri/gen/android/app/src/main/AndroidManifest.xml
git commit -m "feat(android): CameraCapturer (getUserMedia -> RgbaImage) + CAMERA permission

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `CameraOverlay.svelte` — live preview + capture + 4-corner tap

The mobile analog of `RegionOverlay`. Svelte 5 **legacy API** (`export let`, `on:click`, `$:` — no runes).

**Files:**
- Create: `app/src/components/CameraOverlay.svelte`
- Test: `app/src/tests/CameraOverlay.test.ts`

- [ ] **Step 1: Write the failing component test**

`app/src/tests/CameraOverlay.test.ts` — assert the two phases (live → captured-with-taps) and that four taps emit the quad + image. Query by `data-testid`. (Mock `../lib/camera`'s `CameraCapturer` so no real getUserMedia in jsdom.)

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('../lib/camera', () => ({
  CameraCapturer: class {
    constructor(_v: unknown) {}
    async start() {}
    grab() { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; }
    stop() {}
  },
  frameToRgba: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
}));

import CameraOverlay from '../components/CameraOverlay.svelte';

describe('CameraOverlay', () => {
  it('captures, then emits a quad + image after four corner taps', async () => {
    const onConfirm = vi.fn();
    const { getByTestId, queryByTestId } = render(CameraOverlay, { onConfirm });
    // live phase -> capture
    await fireEvent.click(getByTestId('camera-capture'));
    // captured phase: tap 4 corners on the still
    const still = getByTestId('camera-still');
    for (let i = 0; i < 4; i++) await fireEvent.click(still, { clientX: 10 + i, clientY: 20 + i });
    await fireEvent.click(getByTestId('camera-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.quad).toHaveLength(4);
    expect(arg.image.width).toBeGreaterThan(0);
    expect(queryByTestId('camera-confirm-disabled')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails — [HERE]**

Run: `cd app && npx vitest run src/tests/CameraOverlay.test.ts`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `CameraOverlay.svelte`**

Two phases in one component: (a) **live** — a `<video>` with a square framing guide and a `data-testid="camera-capture"` button that calls `CameraCapturer.grab()` and freezes the still onto a `<canvas data-testid="camera-still">`; (b) **captured** — tapping the still records up to 4 corner points (mapping click client coords → image coords via the element's `getBoundingClientRect`), draws markers, and enables `data-testid="camera-confirm"` only once 4 are placed. Confirm dispatches `onConfirm({ image, quad })` (TL,TR,BR,BL order — instruct the user to tap in that order; a "reset taps" button clears). Include the Auto/White/Black board-side selector (reuse the same control/labels as `RegionOverlay`) and dispatch its value too. Follow `RegionOverlay.svelte` for styling/structure. Provide the full component code here (mirroring RegionOverlay's prop/callback pattern — `export let onConfirm: (r: {...}) => void`).

- [ ] **Step 4: Run to verify it passes + check — [HERE]**

Run: `cd app && npx vitest run src/tests/CameraOverlay.test.ts && npm run check`
Expected: PASS, 0/0.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/CameraOverlay.svelte app/src/tests/CameraOverlay.test.ts
git commit -m "feat(android): CameraOverlay — live preview, capture, 4-corner tap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire the mobile snap→analyze flow

Connect capture → warp → vision → Edit → Analysis on mobile, behind `isMobile()`.

**Files:**
- Modify: `app/src/lib/engineClient.ts` (mobile capture path)
- Modify: `app/src/App.svelte` (mount `CameraOverlay` instead of `RegionOverlay` on mobile; screen flow)
- Test: `app/src/tests/androidCaptureFlow.test.ts`

- [ ] **Step 1: Write the failing integration test — [HERE]**

Drive the orchestrator/engineClient with a mobile capture: given a stubbed vision tracker whose `detectPosition` returns a known FEN from a warped image, assert a capture command routes through `warpQuadToSquare` and emits a `StateFrame` with that FEN. (Follow the existing `visionClient.test.ts` / orchestrator vision-handler test patterns; stub the worker.)

- [ ] **Step 2: Run → fail; Step 3: implement; Step 4: run → pass — [HERE]**

On mobile, `makeVisionTracker()` uses a `CameraCapturer`-backed source; a new capture command warps the tapped quad (`warpQuadToSquare`) before handing the square image to `VisionWorkerClient.detectPosition`. `App.svelte` shows `CameraOverlay` on mobile where it shows `RegionOverlay`/capture on desktop, then routes the assembled position to the Edit screen (confirm/fix) → Analysis. Provide the exact wiring against the real signatures at implementation time (grep the current `makeVisionTracker` + capture command). Keep desktop unchanged (`!isMobile()`).

- [ ] **Step 5: Full suite + check — [HERE]**

Run: `cd app && npm test && npm run check`
Expected: all green, 0/0.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/engineClient.ts app/src/App.svelte app/src/tests/androidCaptureFlow.test.ts
git commit -m "feat(android): wire mobile capture -> warp -> vision -> Edit -> Analysis

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: On-device MVP smoke — [DEVICE]

- [ ] **Step 1: Build, install, grant CAMERA — [DEVICE]**

Run the build/install commands (top of plan). Launch; grant the camera permission prompt.

- [ ] **Step 2: Photograph a real board and analyze — [DEVICE]**

Point the Pixel 9 at a monitor/phone showing a chess.com or lichess board (e.g. the installed `com.chess` / `org.lichess.mobileV2`). Frame within the guide, capture, tap the 4 corners, confirm. Expected: the vision read lands on the Edit screen close to the real position; fix any square; Analysis streams eval + best line from the native engine.

- [ ] **Step 3: Record accuracy + iterate on fidelity — [DEVICE]**

If pieces misread badly, check: canvas colour fidelity (`colorSpaceConversion`), the tapped-corner order (TL,TR,BR,BL), and the warp `size` (use ≥ the model-friendly board size, e.g. 512). The Edit screen is the human backstop. Log findings; a persistent misread pattern → a fast-follow auto-tuning task, not an MVP blocker.

- [ ] **Step 4: Commit any fidelity fixes**

```bash
git add -A && git commit -m "fix(android): capture/warp pixel-fidelity tuning from on-device MVP smoke

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done (Plan 2 / MVP)

- `warp.ts`, `camera.ts`, `CameraOverlay`, and the capture-flow wiring are unit-tested; `npm test` + `npm run check` green **[HERE]**.
- On the Pixel 9 **[DEVICE]**: photograph a board on a screen → tap corners → the position reads onto Edit → native-engine analysis streams. Desktop unchanged.

## Self-review notes (author)

- **Spec coverage:** §5.4 camera (Task 2), §5.5 warp (Task 1) + the manual-tap decision (Task 3), §6 MVP flow (Task 4), on-device gate (Task 5). Risk #1 is retired (validated). Auto quad-detection is explicitly a documented fast-follow, not MVP.
- **Placeholder scan:** Tasks 3 & 4's implementation steps describe behavior + testids/signatures but defer full component/wiring code to implementation against the real files (grep-first) — acceptable discovery, not a TODO; `warp.ts` (the novel algorithm) has complete code + tests.
- **Type consistency:** `RgbaImage` reused throughout; `warpQuadToSquare(src, quad, size)` and `Quad = [TL,TR,BR,BL]` consistent across warp/overlay/flow; `frameToRgba`/`CameraCapturer` signatures match their test.
