import { describe, it, expect } from 'vitest';
import { buildManifest, shippedFiles } from '../../scripts/copy-engine.mjs';

const BIN = [
  'stockfish-18.js', 'stockfish-18.wasm',
  'stockfish-18-single.js', 'stockfish-18-single.wasm',
  'stockfish-18-lite.js', 'stockfish-18-lite.wasm',
  'stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm',
  'stockfish-18-asm.js', 'stockfish.js', 'stockfish.wasm',
];

describe('copy-engine manifest', () => {
  it('maps full and lite x single/multi from versioned loaders', () => {
    expect(buildManifest(BIN)).toEqual({
      full: { single: 'stockfish-18-single.js', multi: 'stockfish-18.js' },
      lite: { single: 'stockfish-18-lite-single.js', multi: 'stockfish-18-lite.js' },
    });
  });
  it('ships only the 8 versioned full+lite builds (no asm, no bare symlinks)', () => {
    const shipped = shippedFiles(BIN).sort();
    expect(shipped).toEqual([
      'stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm',
      'stockfish-18-lite.js', 'stockfish-18-lite.wasm',
      'stockfish-18-single.js', 'stockfish-18-single.wasm',
      'stockfish-18.js', 'stockfish-18.wasm',
    ].sort());
    expect(shipped).not.toContain('stockfish-18-asm.js');
    expect(shipped).not.toContain('stockfish.js');
  });
  it('throws if a build family is incomplete', () => {
    expect(() => buildManifest(['stockfish-18-lite.js', 'stockfish-18-lite-single.js'])).toThrow(/full/);
  });
  it('throws if the lite family is incomplete', () => {
    expect(() => buildManifest(['stockfish-18.js', 'stockfish-18-single.js'])).toThrow(/lite/);
  });
});
