import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

vi.hoisted(() => {
  vi.stubGlobal('browser', {
    runtime: {
      id: 'test-extension', getURL: (p: string) => p,
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async () => ({ dataUrl: null }),
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  });
});
vi.mock('../engine/wasmEngine', () => ({ loadWasmEngine: async () => ({ send() {}, onLine() {}, dispose() {} }) }));
vi.mock('../vision/visionTracker', () => ({
  makeTabTracker: () => ({
    detectPosition: async () => null,
    grabFullDesktop: async () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
    setRegion() {}, setSideOverride() {}, setOrientationOverride() {}, reset() {},
  }),
}));

import Panel from '../../entrypoints/sidepanel/Panel.svelte';

describe('Panel analysis toggle', () => {
  it('auto-analyzes a manually loaded FEN when Auto-analyze is on (default)', async () => {
    const { getByTestId } = render(Panel);
    await fireEvent.click(getByTestId('fen-toggle'));
    await fireEvent.input(getByTestId('fen-input'), {
      target: { value: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' },
    });
    await fireEvent.click(getByTestId('load-fen'));
    await waitFor(() => expect(getByTestId('analyze').textContent).toContain('Stop'));
  });

  it('Stop then Analyze toggles the orchestrator analysis state', async () => {
    const { getByTestId } = render(Panel);
    await fireEvent.click(getByTestId('analyze'));                 // enable
    await waitFor(() => expect(getByTestId('analyze').textContent).toContain('Stop'));
    await fireEvent.click(getByTestId('analyze'));                 // disable
    await waitFor(() => expect(getByTestId('analyze').textContent).toContain('Analyze'));
  });
});
