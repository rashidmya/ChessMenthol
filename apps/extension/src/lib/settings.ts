import { writable } from 'svelte/store';
import { browser } from 'wxt/browser';

/** User-tunable analysis + UI preferences, persisted across panel opens. */
export interface Settings {
  lines: number;          // MultiPV, 1..5
  thinkingMs: number;     // search budget per position: 2000 | 5000 | 10000
  autoAnalyze: boolean;   // analyze automatically when a new position arrives
  arrows: boolean;        // draw best-move arrows on the board
  liveSiteReading: boolean; // auto-read chess.com / lichess boards
}

export const DEFAULTS: Settings = {
  lines: 3, thinkingMs: 5000, autoAnalyze: true, arrows: true, liveSiteReading: true,
};

const KEY = 'settings';

/** Reactive settings. Seeded with DEFAULTS; call hydrateSettings() once on mount. */
export const settings = writable<Settings>({ ...DEFAULTS });

/** Load persisted settings over the defaults. Silent on any storage error. */
export async function hydrateSettings(): Promise<void> {
  try {
    const got = await browser.storage?.local?.get?.(KEY);
    const saved = got?.[KEY] as Partial<Settings> | undefined;
    if (saved) settings.set({ ...DEFAULTS, ...saved });
  } catch { /* keep whatever is in the store */ }
}

/** Merge a partial change into the store and write the whole object back. */
export function patchSettings(partial: Partial<Settings>): void {
  settings.update((s) => {
    const next = { ...s, ...partial };
    void browser.storage?.local?.set?.({ [KEY]: next })?.catch?.(() => {});
    return next;
  });
}
