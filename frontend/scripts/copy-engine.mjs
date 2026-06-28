// frontend/scripts/copy-engine.mjs
// Copies the stockfish dist into public/engine/ and writes engine-manifest.json
// mapping the single- and multi-threaded lite builds. Version-agnostic: it
// classifies by filename, so a stockfish upgrade needs no code change.
import { readdirSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'node_modules', 'stockfish', 'bin'); // stockfish@18 ships dist in bin/
const OUT = join(here, '..', 'public', 'engine');

if (!existsSync(SRC)) { console.error(`[copy-engine] missing ${SRC} — run npm install`); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC);
for (const f of files) copyFileSync(join(SRC, f), join(OUT, f));

// Classify by filename (version-agnostic). stockfish@18: lite-single = single,
// lite (no "single") = multi-threaded. Exclude the asm.js fallback from the JS pool.
const js = files.filter((f) => f.endsWith('.js') && !f.includes('.worker') && !f.includes('asm'));
const lite = js.filter((f) => f.includes('lite'));
const pool = lite.length ? lite : js;
const single = pool.find((f) => f.includes('single'));
const multi = pool.find((f) => !f.includes('single')); // lite build without the "single" token
if (!single) { console.error('[copy-engine] no single-threaded build found in', js); process.exit(1); }

writeFileSync(join(OUT, 'engine-manifest.json'),
  JSON.stringify({ single, multi: multi ?? single }, null, 2));
console.log(`[copy-engine] single=${single} multi=${multi ?? '(none, fallback to single)'}`);
