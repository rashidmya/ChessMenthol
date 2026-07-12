// extension/scripts/copy-vision-assets.mjs
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUB = join(here, '..', 'public');

// Locate an installed package's directory by walking up node_modules from here — works whether
// the dep is hoisted to the workspace root or installed locally under extension/node_modules.
function pkgDir(name) {
  let dir = here;
  for (;;) {
    const cand = join(dir, 'node_modules', name);
    if (existsSync(cand)) return cand;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`cannot locate ${name} in any node_modules — run npm install`);
    dir = parent;
  }
}

// 1. Model: reuse the desktop app's model (single source of truth).
const MODEL_SRC = join(here, '..', '..', 'app', 'models', 'pieces.onnx');
if (!existsSync(MODEL_SRC)) { console.error(`[copy-vision-assets] missing ${MODEL_SRC}`); process.exit(1); }
mkdirSync(join(PUB, 'models'), { recursive: true });
copyFileSync(MODEL_SRC, join(PUB, 'models', 'pieces.onnx'));

// 2. ORT runtime: exactly one wasm variant.
const ORT_WASM = 'ort-wasm-simd-threaded.wasm';
const ORT_SRC = join(pkgDir('onnxruntime-web'), 'dist', ORT_WASM);
if (!existsSync(ORT_SRC)) { console.error(`[copy-vision-assets] missing ${ORT_SRC} — run npm install`); process.exit(1); }
mkdirSync(join(PUB, 'ort'), { recursive: true });
copyFileSync(ORT_SRC, join(PUB, 'ort', ORT_WASM));

console.log(`[copy-vision-assets] staged pieces.onnx + ${ORT_WASM} into public/`);
