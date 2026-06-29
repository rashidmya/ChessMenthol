// frontend/scripts/copy-vision-assets.mjs
// Copies the piece-classifier model and the onnxruntime-web wasm runtime into
// public/ so they are served same-origin (COEP require-corp blocks cross-origin).
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUB = join(here, '..', 'public');

// 1. Model: frontend/models/pieces.onnx -> public/models/pieces.onnx
const MODEL_SRC = join(here, '..', 'models', 'pieces.onnx');
if (!existsSync(MODEL_SRC)) { console.error(`[copy-vision-assets] missing ${MODEL_SRC}`); process.exit(1); }
mkdirSync(join(PUB, 'models'), { recursive: true });
copyFileSync(MODEL_SRC, join(PUB, 'models', 'pieces.onnx'));

// 2. ort runtime: the app uses the `onnxruntime-web/wasm` bundle build (embedded
// glue) and fetches exactly ONE artifact — ort-wasm-simd-threaded.wasm — via
// ort.env.wasm.wasmPaths (see frontend/src/vision/vision-worker.ts). Copying the
// other variants (asyncify/jsep/jspi + every .mjs bundle, ~80 MB) is dead weight.
const ORT_SRC = join(here, '..', 'node_modules', 'onnxruntime-web', 'dist');
const ORT_WASM = 'ort-wasm-simd-threaded.wasm';
if (!existsSync(join(ORT_SRC, ORT_WASM))) {
  console.error(`[copy-vision-assets] missing ${join(ORT_SRC, ORT_WASM)} — run npm install`);
  process.exit(1);
}
mkdirSync(join(PUB, 'ort'), { recursive: true });
copyFileSync(join(ORT_SRC, ORT_WASM), join(PUB, 'ort', ORT_WASM));
console.log(`[copy-vision-assets] copied pieces.onnx + ${ORT_WASM} into public/`);
