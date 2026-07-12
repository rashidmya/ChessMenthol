import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory browser.storage.local. Must be in vi.hoisted with a truthy runtime.id
// so @wxt-dev/browser resolves our stub (see conventions).
const store = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  vi.stubGlobal('browser', {
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (obj: Record<string, unknown>) => { Object.assign(store, obj); },
      },
    },
  });
  return store;
});

import { settings, DEFAULTS, hydrateSettings, patchSettings } from './settings';
import { get } from 'svelte/store';

describe('settings store', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; settings.set({ ...DEFAULTS }); });

  it('starts at defaults', () => {
    expect(get(settings)).toEqual(DEFAULTS);
    expect(DEFAULTS).toEqual({ lines: 3, thinkingMs: 5000, autoAnalyze: true, arrows: true, liveSiteReading: true });
  });

  it('patchSettings updates the store and persists', async () => {
    patchSettings({ lines: 5, thinkingMs: 10000 });
    expect(get(settings)).toMatchObject({ lines: 5, thinkingMs: 10000 });
    expect(store['settings']).toMatchObject({ lines: 5, thinkingMs: 10000 });
  });

  it('hydrateSettings merges saved values over defaults', async () => {
    store['settings'] = { arrows: false, thinkingMs: 2000 };
    await hydrateSettings();
    expect(get(settings)).toEqual({ ...DEFAULTS, arrows: false, thinkingMs: 2000 });
  });
});
