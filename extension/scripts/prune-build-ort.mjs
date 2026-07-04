// extension/scripts/prune-build-ort.mjs
// Vite statically emits an onnxruntime-web wasm variant into <target>/assets from the
// `onnxruntime-web/wasm` import graph. The vision worker NEVER fetches it: it pins
// ort.env.wasm.wasmPaths to the STAGED /ort/ort-wasm-simd-threaded.wasm, and the only
// execution provider is 'wasm', so the assets/ copy is unreachable dead weight
// (~13.5 MB per browser target). Prune any ort wasm under <target>/assets for every
// WXT build target under .output/. (The real staged runtime wasm under <target>/ort/
// is untouched — different directory, never globbed here.)
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(here, '..', '.output');

let pruned = 0;
try {
  for (const target of readdirSync(OUTPUT, { withFileTypes: true })) {
    if (!target.isDirectory()) continue;
    const assetsDir = join(OUTPUT, target.name, 'assets');
    try {
      for (const f of readdirSync(assetsDir)) {
        if (f.endsWith('.wasm') && f.startsWith('ort-wasm')) {
          const p = join(assetsDir, f);
          const mb = (statSync(p).size / 1e6).toFixed(1);
          rmSync(p);
          console.log(`[prune-build-ort] removed dead ${target.name}/assets/${f} (${mb} MB)`);
          pruned++;
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
if (!pruned) console.log('[prune-build-ort] no dead ort wasm in .output/*/assets (nothing to prune)');
