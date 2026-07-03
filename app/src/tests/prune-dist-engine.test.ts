import { describe, it, expect } from 'vitest';
import { isDeadDesktopEngineAsset } from '../../scripts/prune-dist-engine.mjs';

describe('prune-dist-engine: desktop-dead in-webview engine assets', () => {
  it('flags the heavy wasm/asm builds the desktop never loads', () => {
    // Desktop uses the native sidecar (isTauri → loadNativeEngine), so every
    // in-webview Stockfish binary in dist/engine is dead weight.
    expect(isDeadDesktopEngineAsset('stockfish-18.wasm')).toBe(true);
    expect(isDeadDesktopEngineAsset('stockfish-18-single.wasm')).toBe(true);
    expect(isDeadDesktopEngineAsset('stockfish-18-lite.wasm')).toBe(true);
    expect(isDeadDesktopEngineAsset('stockfish-18-lite-single.wasm')).toBe(true);
    expect(isDeadDesktopEngineAsset('stockfish-18-asm.js')).toBe(true);
  });

  it('keeps the tiny loaders and manifest (harmless, avoids touching more than needed)', () => {
    expect(isDeadDesktopEngineAsset('stockfish-18.js')).toBe(false);
    expect(isDeadDesktopEngineAsset('stockfish-18-lite.js')).toBe(false);
    expect(isDeadDesktopEngineAsset('engine-manifest.json')).toBe(false);
  });
});
