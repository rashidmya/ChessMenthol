import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const listeners = vi.hoisted(() => {
  const listeners: ((m: unknown) => void)[] = [];
  vi.stubGlobal('browser', {
    runtime: {
      id: 'test-extension', getURL: (p: string) => p,
      onMessage: { addListener: (f: (m: unknown) => void) => listeners.push(f), removeListener: () => {} },
      sendMessage: async () => ({ dataUrl: null }),
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  });
  return listeners;
});
vi.mock('../engine/wasmEngine', () => ({ loadWasmEngine: async () => ({ send() {}, onLine() {}, dispose() {} }) }));
vi.mock('../vision/visionTracker', () => ({ makeTabTracker: () => ({
  detectPosition: async () => null, grabFullDesktop: async () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
  setRegion() {}, setSideOverride() {}, setOrientationOverride() {}, reset() {},
}) }));

import Panel from '../../entrypoints/sidepanel/Panel.svelte';

describe('Panel states + settings view', () => {
  beforeEach(() => { listeners.length = 0; });

  it('hides the FEN editor until the FEN button is clicked', async () => {
    const { queryByTestId, getByTestId } = render(Panel);
    expect(queryByTestId('fen-input')).toBeNull();
    await fireEvent.click(getByTestId('fen-toggle'));
    expect(getByTestId('fen-input')).toBeInTheDocument();
  });

  it('gear opens the settings view and back returns', async () => {
    const { getByTestId, queryByTestId } = render(Panel);
    await fireEvent.click(getByTestId('gear'));
    expect(getByTestId('settings-panel')).toBeInTheDocument();
    await fireEvent.click(getByTestId('gear'));
    expect(queryByTestId('settings-panel')).toBeNull();
  });

  it('shows the adapter-broke card when a site adapter reports not-ok', async () => {
    const { getByTestId } = render(Panel);
    listeners.forEach((f) => f({ kind: 'adapter-status', site: 'chesscom', ok: false }));
    await waitFor(() => expect(getByTestId('status-card').textContent?.toLowerCase()).toContain('capture'));
  });

  it('clears the adapter-broke banner when the user captures instead', async () => {
    const { getByTestId, queryByTestId } = render(Panel);
    listeners.forEach((f) => f({ kind: 'adapter-status', site: 'chesscom', ok: false }));
    await waitFor(() => expect(getByTestId('status-card').textContent?.toLowerCase()).toContain("can't read"));
    await fireEvent.click(getByTestId('status-capture'));
    // adapterOk reset -> the adapter_broke banner must be gone (a different status like
    // no_board may appear from the null-detection mock, but the "can't read" text must not).
    await waitFor(() => {
      const card = queryByTestId('status-card');
      expect(card?.textContent?.toLowerCase() ?? '').not.toContain("can't read");
    });
  });
});
