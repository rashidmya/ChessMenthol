import { defineConfig } from 'wxt';
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Vite statically emits an onnxruntime-web wasm variant into <target>/assets from the
// `onnxruntime-web/wasm` import graph. The vision worker NEVER fetches it: it pins
// ort.env.wasm.wasmPaths to the STAGED /ort/ort-wasm-simd-threaded.wasm, and the only
// execution provider is 'wasm', so the assets/ copy is unreachable dead weight (~13.5 MB
// per target). Drop it after every build — incl. inside `wxt zip`, where npm's postbuild
// hook never runs. The staged runtime wasm under <target>/ort/ is a different dir, untouched.
function pruneDeadOrtWasm(dir: string): void {
  // `dir` (wxt.config.outDir) is a build's target dir (…/chrome-mv3); also handle it being
  // the base .output (with per-target subdirs) so this is robust to WXT internals.
  const roots = [dir];
  try {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) roots.push(join(dir, d.name));
    }
  } catch { return; }
  let removed = 0;
  for (const root of roots) {
    const assets = join(root, 'assets');
    let files: string[] = [];
    try { files = readdirSync(assets); } catch { continue; }
    for (const f of files) {
      if (f.startsWith('ort-wasm') && f.endsWith('.wasm')) {
        const p = join(assets, f);
        const mb = (statSync(p).size / 1e6).toFixed(1);
        rmSync(p);
        console.log(`[wxt] pruned dead ${f} (${mb} MB)`);
        removed++;
      }
    }
  }
  if (!removed) console.log('[wxt] no dead ort wasm to prune');
}

// COEP/COOP make extension pages cross-origin isolated -> SharedArrayBuffer ->
// the multithreaded engine/ort builds are *available* (Plan 1 ships single-threaded,
// but keeping isolation on now avoids a manifest change later).
export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  hooks: {
    'build:done': (wxt) => pruneDeadOrtWasm(wxt.config.outDir),
  },
  manifest: {
    name: 'ChessMenthol',
    description: 'Reconstructs the board on any page and analyzes it with Stockfish.',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['*://*.chess.com/*', '*://lichess.org/*'],
    action: {}, // toolbar button — required for sidePanel.setPanelBehavior({ openPanelOnActionClick })
    // A sidepanel entrypoint makes WXT emit Chrome `side_panel` + Firefox `sidebar_action`.
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
    // Chrome MV3's default CSP disables WebAssembly; 'wasm-unsafe-eval' lets the
    // Stockfish WASM worker compile. (COEP/COOP only gate SharedArrayBuffer, which
    // the single-threaded baseline doesn't use — this is the line that makes the
    // engine actually run on Chrome.)
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    web_accessible_resources: [
      { resources: ['engine/*', 'models/*', 'ort/*'], matches: ['<all_urls>'] },
    ],
  },
  vite: () => ({
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['onnxruntime-web'] },
  }),
});
