// app/scripts/prune-dist-ort.mjs
// Vite statically emits an onnxruntime-web wasm variant into dist/assets from the
// `onnxruntime-web/wasm` import graph. The app NEVER fetches it: ort.env.wasm.wasmPaths
// pins the URL to /ort/ort-wasm-simd-threaded.wasm and the only execution provider is
// 'wasm', so the jsep/webgpu variant is unreachable. Tauri ships all of dist, so this
// dead file would bloat the bundle by ~26 MB. Prune any ort wasm under dist/assets.
// (The real runtime wasm under dist/ort/ and Stockfish under dist/engine/ are untouched.)
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, '..', 'dist', 'assets');
let pruned = 0;
try {
  for (const f of readdirSync(ASSETS)) {
    if (f.endsWith('.wasm') && f.startsWith('ort-wasm')) {
      const p = join(ASSETS, f);
      const mb = (statSync(p).size / 1e6).toFixed(1);
      rmSync(p);
      console.log(`[prune-dist-ort] removed dead dist/assets/${f} (${mb} MB)`);
      pruned++;
    }
  }
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (!pruned) console.log('[prune-dist-ort] no dead ort wasm in dist/assets (nothing to prune)');
