import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

// Minimal fake browser so Panel's listener wiring + wasm loader import don't explode.
// (See Panel.test.ts for why this must live in vi.hoisted with a truthy runtime.id.)
vi.hoisted(() => {
  vi.stubGlobal('browser', {
    runtime: {
      id: 'test-extension',
      getURL: (p: string) => p,
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async () => ({ dataUrl: null }),
    },
  });
});
vi.mock('../engine/wasmEngine', () => ({ loadWasmEngine: async () => ({ send() {}, onLine() {}, dispose() {} }) }));

// This tracker's detectPosition resolves to a legal, non-startpos position so the
// orchestrator's _applyDetection actually applies a new FEN (placement differs from
// startpos) and flips orientation to black.
vi.mock('../vision/visionTracker', () => ({
  makeTabTracker: () => ({
    detectPosition: async () => ({
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      isLegal: true,
      status: 'valid',
      lowConfidence: [],
      move: 'e2e4',
      orientation: 'black_bottom',
      sideToMove: 'black',
    }),
    grabFullDesktop: async () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
    setRegion() {}, setSideOverride() {}, setOrientationOverride() {}, reset() {},
  }),
}));

import Panel from '../../entrypoints/sidepanel/Panel.svelte';

describe('Panel vision capture', () => {
  it('shows the detected position and a vision source after Capture screen', async () => {
    const { getByTestId } = render(Panel);
    await fireEvent.click(getByTestId('capture'));

    await waitFor(() => {
      expect(getByTestId('current-fen').textContent).toContain('4P3');
    });
    expect(getByTestId('source').textContent).toContain('vision');
  });
});
