/// <reference lib="webworker" />
// (above: pulls in the DedicatedWorkerGlobalScope lib so TS resolves
//  `self.onmessage`/`postMessage` here — the default app lib set omits it.)
// app/src/vision/vision-worker.ts
//
// The real ONNX host: a THIN worker shell around the ported CV pipeline. It
// lazily builds an onnxruntime-web InferenceSession + PieceClassifier + Tracker
// and dispatches the client's message protocol off the main thread. It is
// exercised end-to-end only in Group vi (manual, in `tauri dev`) — there is no
// unit test for this file (jsdom can't run a real Worker or ort-web); the
// FakeWorker test in visionClient.test.ts covers the protocol on the client side.
// Import the WASM-ONLY, *bundle* build (not the default multi-backend one):
//  - `/wasm`   → no WebGPU/jsep, so it loads the 13.5MB plain wasm, not the 26MB
//                jsep variant (smaller bundle).
//  - `bundle`  → the JS glue is EMBEDDED, so ort never does a separate dynamic
//                import() of `…jsep.mjs`. That import is what Vite's dev server
//                rejects ("file is in /public … should not be imported from
//                source code"); the bundle build only *fetches* the .wasm
//                binary, which IS allowed from /public in dev.
import * as ort from 'onnxruntime-web/wasm';
import { Tracker } from './tracker';
import { PieceClassifier, ortRunner, type InferenceLike } from './pieces';
import type { RgbaImage } from '../lib/image';
import type { Orientation } from './types';

// Override ONLY the .wasm URL (object form), NOT a string prefix. The `/wasm`
// *bundle* build embeds its JS glue, and ort uses that embedded glue as long as
// neither a `.mjs` override nor a string `wasmPaths` PREFIX is set (see ort's
// wasm-utils-import `useEmbeddedModule`). A string prefix ('/ort/') would DISABLE
// the embedded glue and make ort dynamically import() `…mjs` from /public — which
// Vite's dev server refuses ("should not be imported from source code"). With the
// object form, ort imports nothing and merely FETCHES the .wasm (allowed for
// /public files in dev). The binary is copied to public/ort by copy-vision-assets.
ort.env.wasm.wasmPaths = { wasm: '/ort/ort-wasm-simd-threaded.wasm' };
ort.env.wasm.numThreads = 1; // tiny CNN; no SAB dependency

let trackerPromise: Promise<Tracker> | null = null;
function getTracker(): Promise<Tracker> {
  if (!trackerPromise) {
    trackerPromise = ort.InferenceSession
      .create('/models/pieces.onnx', { executionProviders: ['wasm'] })
      .then((session) => new Tracker(new PieceClassifier(ortRunner(session as unknown as InferenceLike, ort.Tensor))));
  }
  return trackerPromise;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { id: number; type: 'detect'; image: RgbaImage }
    | { type: 'setSideOverride'; white: boolean | null }
    | { type: 'setOrientationOverride'; orientation: Orientation | null }
    | { type: 'reset' };
  // Whole body guarded so that init failure (getTracker rejecting on a missing
  // model / bad wasm path / CSP block) surfaces as a per-message rejection for
  // a `detect` message instead of an unhandled worker error that hangs the
  // pending promise. Fire-and-forget messages (override/reset) carry no id, so
  // a failed init is simply swallowed (no-op).
  try {
    const tracker = await getTracker();
    if (msg.type === 'setSideOverride') return void tracker.setSideOverride(msg.white);
    if (msg.type === 'setOrientationOverride') return void tracker.setOrientationOverride(msg.orientation);
    if (msg.type === 'reset') return void tracker.reset();
    if (msg.type === 'detect') {
      const result = await tracker.detectPosition(msg.image);
      // cast is type-only: DedicatedWorkerGlobalScope.postMessage overloads
      // differ from Worker's, but the runtime call is the same.
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result });
    }
  } catch (err) {
    // Only a detect message has an id to reject against; drop failures for the
    // fire-and-forget override/reset messages.
    if ('id' in msg) {
      (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: String(err) });
    }
  }
};
