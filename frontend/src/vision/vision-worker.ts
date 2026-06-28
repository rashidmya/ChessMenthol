/// <reference lib="webworker" />
// (above: pulls in the DedicatedWorkerGlobalScope lib so TS resolves
//  `self.onmessage`/`postMessage` here — the default app lib set omits it.)
// frontend/src/vision/vision-worker.ts
//
// The real ONNX host: a THIN worker shell around the ported CV pipeline. It
// lazily builds an onnxruntime-web InferenceSession + PieceClassifier + Tracker
// and dispatches the client's message protocol off the main thread. It is
// exercised end-to-end only in Group vi (manual, in `tauri dev`) — there is no
// unit test for this file (jsdom can't run a real Worker or ort-web); the
// FakeWorker test in visionClient.test.ts covers the protocol on the client side.
import * as ort from 'onnxruntime-web';
import { Tracker } from './tracker';
import { PieceClassifier, ortRunner, type InferenceLike } from './pieces';
import type { RgbaImage } from '../lib/capture';
import type { Orientation } from './types';

ort.env.wasm.wasmPaths = '/ort/';
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
