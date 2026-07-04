import { defineConfig } from 'wxt';
import { resolve } from 'node:path';

// COEP/COOP make extension pages cross-origin isolated -> SharedArrayBuffer ->
// the multithreaded engine/ort builds are *available* (Plan 1 ships single-threaded,
// but keeping isolation on now avoids a manifest change later).
export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'ChessMenthol',
    description: 'Reconstructs the board on any page and analyzes it with Stockfish.',
    permissions: ['storage'],
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
      { resources: ['engine/*'], matches: ['<all_urls>'] },
    ],
  },
  vite: () => ({
    resolve: { alias: { '@core': resolve(__dirname, '../app/src') } },
    worker: { format: 'es' },
  }),
});
