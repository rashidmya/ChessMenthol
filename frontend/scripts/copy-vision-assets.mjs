// frontend/scripts/copy-vision-assets.mjs
// Copies the piece-classifier model and the onnxruntime-web wasm runtime into
// public/ so they are served same-origin (COEP require-corp blocks cross-origin).
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUB = join(here, '..', 'public');

// 1. Model: frontend/models/pieces.onnx -> public/models/pieces.onnx
const MODEL_SRC = join(here, '..', 'models', 'pieces.onnx');
if (!existsSync(MODEL_SRC)) { console.error(`[copy-vision-assets] missing ${MODEL_SRC}`); process.exit(1); }
mkdirSync(join(PUB, 'models'), { recursive: true });
copyFileSync(MODEL_SRC, join(PUB, 'models', 'pieces.onnx'));

// 2. ort runtime: node_modules/onnxruntime-web/dist/*.wasm + *.mjs -> public/ort/
const ORT_SRC = join(here, '..', 'node_modules', 'onnxruntime-web', 'dist');
if (!existsSync(ORT_SRC)) {
  console.error(`[copy-vision-assets] missing ${ORT_SRC} — run npm install`);
  process.exit(1);
}
mkdirSync(join(PUB, 'ort'), { recursive: true });
for (const f of readdirSync(ORT_SRC)) {
  if (statSync(join(ORT_SRC, f)).isFile() && (f.endsWith('.wasm') || f.endsWith('.mjs'))) {
    copyFileSync(join(ORT_SRC, f), join(PUB, 'ort', f));
  }
}
console.log('[copy-vision-assets] copied pieces.onnx + ort runtime into public/');
