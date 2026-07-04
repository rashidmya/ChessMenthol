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
    web_accessible_resources: [
      { resources: ['engine/*'], matches: ['<all_urls>'] },
    ],
  },
  vite: () => ({
    resolve: { alias: { '@core': resolve(__dirname, '../app/src') } },
    worker: { format: 'es' },
  }),
});
