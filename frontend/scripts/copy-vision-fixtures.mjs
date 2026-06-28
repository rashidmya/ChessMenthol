// frontend/scripts/copy-vision-fixtures.mjs
// One-time: copy the committed Python vision fixtures into the frontend test tree.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'tests', 'vision', 'fixtures');
const DST = join(here, '..', 'src', 'tests', 'fixtures', 'vision');
if (!existsSync(SRC)) { console.error(`[copy-vision-fixtures] missing ${SRC}`); process.exit(1); }
mkdirSync(DST, { recursive: true });
cpSync(SRC, DST, { recursive: true }); // 4 board PNGs + ground_truth.json + pieces/*/*.png
console.log(`[copy-vision-fixtures] copied ${SRC} -> ${DST}`);
