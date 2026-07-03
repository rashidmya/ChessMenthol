// app/scripts/prune-dist-engine.mjs
// Desktop-only prune (run from `build:tauri`, NOT the plain web `build`). On the
// desktop the analysis engine is the native Stockfish sidecar (engineClient:
// `isTauri() ? loadNativeEngine() : loadStockfish()`), so the in-webview wasm/asm
// Stockfish builds Vite copies into dist/engine/ are never loaded — ~240 MB of
// dead weight the Tauri bundle would otherwise ship. Drop the heavy binaries;
// the web build keeps them (it runs plain `build`, not this).
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True for the heavy in-webview engine binaries the desktop never loads (the
 * compiled wasm and the asm.js fallback). The tiny .js loaders + manifest are
 * left alone. Pure.
 * @param {string} name
 */
export function isDeadDesktopEngineAsset(name) {
  return name.endsWith('.wasm') || name.endsWith('-asm.js');
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const ENGINE = join(here, '..', 'dist', 'engine');
  let pruned = 0;
  let freed = 0;
  try {
    for (const f of readdirSync(ENGINE)) {
      if (!isDeadDesktopEngineAsset(f)) continue;
      const p = join(ENGINE, f);
      const bytes = statSync(p).size;
      rmSync(p);
      freed += bytes;
      pruned++;
      console.log(`[prune-dist-engine] removed dist/engine/${f} (${(bytes / 1e6).toFixed(1)} MB)`);
    }
  } catch (e) {
    if (e instanceof Error && /** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') throw e;
  }
  console.log(
    pruned
      ? `[prune-dist-engine] pruned ${pruned} file(s), freed ${(freed / 1e6).toFixed(0)} MB (desktop uses the native sidecar)`
      : '[prune-dist-engine] no in-webview engine binaries in dist/engine (nothing to prune)',
  );
}

// Only run as a side effect when invoked directly, so tests can import the pure helper.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
