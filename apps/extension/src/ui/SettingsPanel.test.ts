import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';

const store = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  vi.stubGlobal('browser', {
    runtime: { id: 'test-extension' },
    storage: { local: { get: async () => ({}), set: async (o: Record<string, unknown>) => { Object.assign(store, o); } } },
  });
  return store;
});

import SettingsPanel from '../../entrypoints/sidepanel/SettingsPanel.svelte';
import { settings, DEFAULTS } from '../../src/lib/settings';

describe('SettingsPanel', () => {
  beforeEach(() => settings.set({ ...DEFAULTS }));

  it('picks a thinking-time preset', async () => {
    const { getByTestId } = render(SettingsPanel);
    await fireEvent.click(getByTestId('time-10000'));
    expect(get(settings).thinkingMs).toBe(10000);
  });

  it('toggles arrows off', async () => {
    const { getByTestId } = render(SettingsPanel);
    await fireEvent.click(getByTestId('toggle-arrows'));
    expect(get(settings).arrows).toBe(false);
  });

  it('steps lines up', async () => {
    const { getByTestId } = render(SettingsPanel);
    await fireEvent.click(getByTestId('lines-inc'));
    expect(get(settings).lines).toBe(DEFAULTS.lines + 1);
  });
});
