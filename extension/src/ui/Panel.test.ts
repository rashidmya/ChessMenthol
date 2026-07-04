import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// Minimal fake browser so Panel's listener wiring + wasm loader import don't explode.
//
// NOTE: this must be set up via `vi.hoisted` (not a plain top-level `vi.stubGlobal`
// call before the `import Panel ...` below). ES import declarations are hoisted above
// ordinary statements regardless of source position, so `Panel.svelte` (and its
// `wxt/browser` import) would otherwise evaluate *before* the stub is installed.
// `@wxt-dev/browser` captures `globalThis.browser?.runtime?.id ? globalThis.browser :
// globalThis.chrome` into a module-level `const` at first evaluation, so the stub also
// needs a truthy `runtime.id` or it silently resolves to `globalThis.chrome` (undefined
// in jsdom) instead of our fake.
vi.hoisted(() => {
  vi.stubGlobal('browser', {
    runtime: {
      id: 'test-extension',
      getURL: (p: string) => p,
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async () => {},
    },
  });
});
// Avoid constructing a real engine Worker in jsdom (paths resolve from src/ui/):
vi.mock('../engine/wasmEngine', () => ({ loadWasmEngine: async () => ({ send() {}, onLine() {}, dispose() {} }) }));
// Avoid constructing a real vision Worker in jsdom (Panel now calls makeTabTracker at
// module scope; `new Worker(new URL(...))` throws under jsdom).
vi.mock('../vision/visionTracker', () => ({ makeTabTracker: () => ({
  detectPosition: async () => null, grabFullDesktop: async () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
  setRegion() {}, setSideOverride() {}, setOrientationOverride() {}, reset() {},
}) }));

import Panel from '../../entrypoints/sidepanel/Panel.svelte';

describe('Panel', () => {
  it('renders a board and a FEN input', () => {
    const { getByTestId } = render(Panel);
    expect(getByTestId('fen-input')).toBeInTheDocument();
    expect(getByTestId('board')).toBeInTheDocument();
  });

  it('updates the shown FEN when the user submits one', async () => {
    const { getByTestId } = render(Panel);
    const input = getByTestId('fen-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '8/8/8/8/8/8/8/4K2k w - - 0 1' } });
    await fireEvent.click(getByTestId('load-fen'));
    expect(getByTestId('current-fen').textContent).toContain('4K2k');
  });
});
