// frontend/scripts/copy-engine.mjs
// Copies the stockfish dist into public/engine/ and writes engine-manifest.json mapping
// BOTH families x threading: { full:{single,multi}, lite:{single,multi} }. Version-agnostic
// (classifies by filename, so a stockfish upgrade needs no code change). The `stockfish`
// preset loads the full (~108MB) build; `stockfish_lite` loads the lite (~7MB) build. The
// asm.js fallback and the bare stockfish.js/.wasm symlinks are NOT shipped (the webview
// always has wasm; each loader derives its .wasm from its own .js name).
import { readdirSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build the 2-axis manifest from stockfish bin filenames. Pure; throws if a build is missing.
 * @param {string[]} files
 */
export function buildManifest(files) {
  const js = files.filter(
    (/** @type {string} */ f) => /^stockfish-\d/.test(f) && f.endsWith('.js') && !f.endsWith('-asm.js') && !f.includes('.worker'),
  );
  /** @param {boolean} lite */
  const pick = (lite) => {
    const fam = js.filter((/** @type {string} */ f) => (lite ? f.includes('lite') : !f.includes('lite')));
    const single = fam.find((/** @type {string} */ f) => f.includes('single'));
    const multi = fam.find((/** @type {string} */ f) => !f.includes('single'));
    if (!single || !multi) {
      throw new Error(`[copy-engine] missing ${lite ? 'lite' : 'full'} build(s) in ${JSON.stringify(js)}`);
    }
    return { single, multi };
  };
  return { full: pick(false), lite: pick(true) };
}

/**
 * The bin files we ship: versioned full+lite loaders & wasms (drops asm.js + bare symlinks).
 * @param {string[]} files
 */
export function shippedFiles(files) {
  return files.filter((/** @type {string} */ f) => /^stockfish-\d/.test(f) && !f.endsWith('-asm.js'));
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const SRC = join(here, '..', 'node_modules', 'stockfish', 'bin');
  const OUT = join(here, '..', 'public', 'engine');
  if (!existsSync(SRC)) { console.error(`[copy-engine] missing ${SRC} — run npm install`); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  const files = readdirSync(SRC);
  for (const f of shippedFiles(files)) copyFileSync(join(SRC, f), join(OUT, f));
  const manifest = buildManifest(files);
  writeFileSync(join(OUT, 'engine-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[copy-engine] full={${manifest.full.single}, ${manifest.full.multi}} lite={${manifest.lite.single}, ${manifest.lite.multi}}`);
}

// Only run when invoked directly, so tests can import the helpers without side effects.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
