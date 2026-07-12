/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import { Tracker } from '@core/vision/tracker';
import { PieceClassifier, ortRunner, type InferenceLike } from '@core/vision/pieces';
import type { RgbaImage } from '@core/lib/image';
import type { Orientation } from '@core/vision/types';

// Extension pages/workers run at chrome-extension://<id>/ — resolve staged assets there.
const base = self.location.origin;
ort.env.wasm.wasmPaths = { wasm: `${base}/ort/ort-wasm-simd-threaded.wasm` };
ort.env.wasm.numThreads = 1;

let trackerPromise: Promise<Tracker> | null = null;
function getTracker(): Promise<Tracker> {
  if (!trackerPromise) {
    trackerPromise = ort.InferenceSession
      .create(`${base}/models/pieces.onnx`, { executionProviders: ['wasm'] })
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
  try {
    const tracker = await getTracker();
    if (msg.type === 'setSideOverride') return void tracker.setSideOverride(msg.white);
    if (msg.type === 'setOrientationOverride') return void tracker.setOrientationOverride(msg.orientation);
    if (msg.type === 'reset') return void tracker.reset();
    if (msg.type === 'detect') {
      const result = await tracker.detectPosition(msg.image);
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result });
    }
  } catch (err) {
    if ('id' in msg) (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: String(err) });
  }
};
