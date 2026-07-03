import { describe, it, expect, vi, afterEach } from 'vitest';

// Build a controllable matchMedia mock and install it on window.
function installMatchMedia(initial: boolean) {
  let listener: ((e: { matches: boolean }) => void) | null = null;
  const mql = {
    matches: initial,
    media: '',
    addEventListener: (_type: string, l: (e: { matches: boolean }) => void) => { listener = l; },
    removeEventListener: () => { listener = null; },
  };
  // @ts-expect-error jsdom has no matchMedia by default
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return { fire: (matches: boolean) => { mql.matches = matches; listener?.({ matches }); } };
}

afterEach(() => { vi.resetModules(); });

describe('isNarrow store', () => {
  it('starts from matchMedia().matches and updates on change', async () => {
    const { fire } = installMatchMedia(true);
    const { isNarrow } = await import('../lib/viewport');
    let val: boolean | undefined;
    const unsub = isNarrow.subscribe((v) => (val = v));
    expect(val).toBe(true);
    fire(false);
    expect(val).toBe(false);
    unsub();
  });

  it('defaults to false when matchMedia is unavailable', async () => {
    // @ts-expect-error simulate no matchMedia
    window.matchMedia = undefined;
    const { isNarrow } = await import('../lib/viewport');
    let val: boolean | undefined;
    const unsub = isNarrow.subscribe((v) => (val = v));
    expect(val).toBe(false);
    unsub();
  });
});
