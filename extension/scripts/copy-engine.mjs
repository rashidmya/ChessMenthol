// Stage the Stockfish 18 lite single-threaded build into public/engine/ as
// web-accessible resources (CSP-safe: loaded via a bundled Worker URL, never
// eval'd). "lite" = small NNUE net; "single" = no threads / no SharedArrayBuffer,
// so it runs in Chrome and Firefox with no cross-origin-isolation requirement.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'node_modules', 'stockfish', 'bin');
const dest = join(here, '..', 'public', 'engine');
mkdirSync(dest, { recursive: true });

// The .js is emscripten glue that loads the sibling .wasm from the same dir, so
// both must be staged together.
const files = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];
for (const f of files) cpSync(join(src, f), join(dest, f));
console.log(`[copy-engine] staged ${files.length} file(s) -> public/engine/`, files);
