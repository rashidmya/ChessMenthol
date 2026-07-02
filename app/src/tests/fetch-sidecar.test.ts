import { describe, it, expect } from 'vitest';
import { hostTriple, assetFor, binaryInArchive } from '../../scripts/fetch-sidecar.mjs';

describe('fetch-sidecar target mapping', () => {
  it('maps host platform+arch to the four supported Rust triples', () => {
    expect(hostTriple('linux', 'x64')).toBe('x86_64-unknown-linux-gnu');
    expect(hostTriple('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
    expect(hostTriple('darwin', 'arm64')).toBe('aarch64-apple-darwin');
    expect(hostTriple('darwin', 'x64')).toBe('x86_64-apple-darwin');
  });

  it('throws on an unsupported host', () => {
    expect(() => hostTriple('linux', 'arm64')).toThrow();
  });

  it('maps each triple to its sf release asset + Tauri sidecar filename', () => {
    expect(assetFor('x86_64-unknown-linux-gnu')).toEqual({
      asset: 'stockfish-ubuntu-x86-64-avx2.tar',
      out: 'stockfish-x86_64-unknown-linux-gnu',
    });
    expect(assetFor('x86_64-pc-windows-msvc')).toEqual({
      asset: 'stockfish-windows-x86-64-avx2.zip',
      out: 'stockfish-x86_64-pc-windows-msvc.exe',
    });
    expect(assetFor('aarch64-apple-darwin')).toEqual({
      asset: 'stockfish-macos-m1-apple-silicon.tar',
      out: 'stockfish-aarch64-apple-darwin',
    });
    expect(assetFor('x86_64-apple-darwin')).toEqual({
      asset: 'stockfish-macos-x86-64-avx2.tar',
      out: 'stockfish-x86_64-apple-darwin',
    });
  });

  it('throws on an unknown triple', () => {
    expect(() => assetFor('mips-unknown-linux-gnu')).toThrow();
  });

  it('derives the in-archive binary path from the asset name', () => {
    // Official sf_18 archives wrap the binary in a top-level `stockfish/` dir,
    // named after the asset (minus extension); Windows zips add `.exe`.
    expect(binaryInArchive('stockfish-ubuntu-x86-64-avx2.tar')).toBe(
      'stockfish/stockfish-ubuntu-x86-64-avx2',
    );
    expect(binaryInArchive('stockfish-macos-m1-apple-silicon.tar')).toBe(
      'stockfish/stockfish-macos-m1-apple-silicon',
    );
    expect(binaryInArchive('stockfish-windows-x86-64-avx2.zip')).toBe(
      'stockfish/stockfish-windows-x86-64-avx2.exe',
    );
  });
});
