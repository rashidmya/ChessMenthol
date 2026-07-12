import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

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
import { settings, DEFAULTS } from '../../src/lib/settings';

describe('Panel main-screen controls', () => {
  beforeEach(() => settings.set({ ...DEFAULTS }));

  it('turn switch flips the orchestrator side to move', async () => {
    const { getByTestId } = render(Panel);
    const toggle = () => getByTestId('turn-toggle');
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false')); // White initially
    await fireEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'));  // -> Black
  });

  it('Live site reading toggle on the main screen flips the setting', async () => {
    const { getByTestId } = render(Panel);
    expect(get(settings).liveSiteReading).toBe(true);
    await fireEvent.click(getByTestId('toggle-live-main'));
    await waitFor(() => expect(get(settings).liveSiteReading).toBe(false));
  });
});
