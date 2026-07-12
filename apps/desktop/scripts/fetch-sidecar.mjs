// app/scripts/fetch-sidecar.mjs
// Provisions the native Stockfish sidecar (+ its NNUE net) that `tauri build`
// bundles via externalBin/resources. These assets are gitignored (large, native,
// per-platform), so CI must fetch them fresh before building — and each platform
// needs its own target-triple-named binary. We pull the official Stockfish `sf_18`
// release (the exact version + nets the app was validated against).
//
//   node scripts/fetch-sidecar.mjs                 # host triple only (CI smoke / dev)
//   node scripts/fetch-sidecar.mjs <triple> [...]  # explicit triples (macOS universal: both arches)
//
// The SIMD variant below affects engine SPEED only, never analysis parity (same
// net + search) — `avx2` is the ~2013+ compatibility floor; drop to `sse41-popcnt`
// to support older x86-64 CPUs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, copyFileSync, chmodSync, createWriteStream, existsSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Pinned official Stockfish release + its default big net (EvalFile), fetched into resources/engine. */
const SF_TAG = 'sf_18';
const NET_NAME = 'nn-c288c895ea92.nnue';
const VARIANT = 'avx2';

const RELEASE = `https://github.com/official-stockfish/Stockfish/releases/download/${SF_TAG}`;
const NET_URL = `https://tests.stockfishchess.org/api/nn/${NET_NAME}`;

/** @type {Record<string, {asset: string, out: string}>} */
const TARGETS = {
  'x86_64-unknown-linux-gnu': {
    asset: `stockfish-ubuntu-x86-64-${VARIANT}.tar`,
    out: 'stockfish-x86_64-unknown-linux-gnu',
  },
  'x86_64-pc-windows-msvc': {
    asset: `stockfish-windows-x86-64-${VARIANT}.zip`,
    out: 'stockfish-x86_64-pc-windows-msvc.exe',
  },
  'aarch64-apple-darwin': {
    asset: 'stockfish-macos-m1-apple-silicon.tar',
    out: 'stockfish-aarch64-apple-darwin',
  },
  'x86_64-apple-darwin': {
    asset: `stockfish-macos-x86-64-${VARIANT}.tar`,
    out: 'stockfish-x86_64-apple-darwin',
  },
};

/**
 * Rust target triple for the running host. Pure.
 * @param {NodeJS.Platform} platform @param {string} arch
 */
export function hostTriple(platform, arch) {
  const key = `${platform}/${arch}`;
  /** @type {Record<string, string>} */
  const map = {
    'linux/x64': 'x86_64-unknown-linux-gnu',
    'win32/x64': 'x86_64-pc-windows-msvc',
    'darwin/arm64': 'aarch64-apple-darwin',
    'darwin/x64': 'x86_64-apple-darwin',
  };
  const triple = map[key];
  if (!triple) throw new Error(`[fetch-sidecar] unsupported host ${key}`);
  return triple;
}

/**
 * Release asset + Tauri sidecar filename for a triple. Pure.
 * @param {string} triple
 */
export function assetFor(triple) {
  const t = TARGETS[triple];
  if (!t) throw new Error(`[fetch-sidecar] unknown target triple ${triple}`);
  return { asset: t.asset, out: t.out };
}

/**
 * Path of the engine binary inside an extracted sf release archive. Pure.
 * The archive wraps everything in a top-level `stockfish/` dir; the binary is
 * named after the asset minus its extension (Windows zips carry a `.exe`).
 * @param {string} asset
 */
export function binaryInArchive(asset) {
  const isZip = asset.endsWith('.zip');
  const base = asset.replace(/\.(tar|zip)$/, '');
  return `stockfish/${base}${isZip ? '.exe' : ''}`;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Download with a few retries — the GitHub release CDN and net server occasionally blip in CI.
 * @param {string} url @param {string} dest */
async function download(url, dest) {
  const attempts = 3;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      return;
    } catch (e) {
      if (i === attempts) throw new Error(`[fetch-sidecar] ${e instanceof Error ? e.message : e}`);
      console.log(`[fetch-sidecar] retry ${i}/${attempts - 1} after error: ${e instanceof Error ? e.message : e}`);
      await sleep(2000 * i);
    }
  }
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const TAURI = join(here, '..', 'src-tauri');
  const BIN_DIR = join(TAURI, 'binaries');
  const NET_DIR = join(TAURI, 'resources', 'engine');
  mkdirSync(BIN_DIR, { recursive: true });
  mkdirSync(NET_DIR, { recursive: true });

  const triples = process.argv.slice(2);
  if (triples.length === 0) triples.push(hostTriple(process.platform, process.arch));

  const work = mkdtempSync(join(tmpdir(), 'sf-sidecar-'));
  try {
    for (const triple of triples) {
      const { asset, out } = assetFor(triple);
      const archive = join(work, asset);
      console.log(`[fetch-sidecar] ${triple}: downloading ${asset}`);
      await download(`${RELEASE}/${asset}`, archive);
      const extractDir = join(work, triple);
      mkdirSync(extractDir, { recursive: true });
      execFileSync('tar', ['-xf', archive, '-C', extractDir]); // bsdtar handles .tar and .zip on all runners
      const src = join(extractDir, binaryInArchive(asset));
      if (!existsSync(src)) throw new Error(`[fetch-sidecar] binary not found in archive: ${src}`);
      const dest = join(BIN_DIR, out);
      copyFileSync(src, dest);
      chmodSync(dest, 0o755);
      console.log(`[fetch-sidecar] -> binaries/${out}`);
    }

    // A `--target universal-apple-darwin` build wants ONE fat sidecar named with
    // the universal triple; lipo the two per-arch binaries together when both are
    // present (there is no prebuilt universal Stockfish to download).
    const macArm = join(BIN_DIR, 'stockfish-aarch64-apple-darwin');
    const macX64 = join(BIN_DIR, 'stockfish-x86_64-apple-darwin');
    if (existsSync(macArm) && existsSync(macX64)) {
      const universal = join(BIN_DIR, 'stockfish-universal-apple-darwin');
      console.log('[fetch-sidecar] lipo -> binaries/stockfish-universal-apple-darwin');
      execFileSync('lipo', ['-create', '-output', universal, macArm, macX64]);
      chmodSync(universal, 0o755);
    }

    const net = join(NET_DIR, NET_NAME);
    if (existsSync(net)) {
      console.log(`[fetch-sidecar] net present: resources/engine/${NET_NAME}`);
    } else {
      console.log(`[fetch-sidecar] downloading net ${NET_NAME}`);
      await download(NET_URL, net);
      console.log(`[fetch-sidecar] -> resources/engine/${NET_NAME}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Only run as a side effect when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
