import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

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
const listeners = vi.hoisted(() => {
  const listeners: ((m: unknown) => void)[] = [];
  vi.stubGlobal('browser', {
    runtime: {
      id: 'test-extension',
      getURL: (p: string) => p,
      onMessage: { addListener: (f: (m: unknown) => void) => listeners.push(f), removeListener: () => {} },
      sendMessage: async () => {},
    },
  });
  return listeners;
});
// Avoid constructing a real engine Worker in jsdom (paths resolve from src/ui/):
vi.mock('../engine/wasmEngine', () => ({ loadWasmEngine: async () => ({ send() {}, onLine() {}, dispose() {} }) }));

import Panel from '../../entrypoints/sidepanel/Panel.svelte';

describe('Panel position ingest', () => {
  beforeEach(() => { listeners.length = 0; });
  it('updates the shown FEN and source when a position arrives', async () => {
    const { getByTestId } = render(Panel);
    listeners.forEach((f) => f({ kind: 'position', site: 'lichess', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1', orientation: 'white', turn: 'b' }));
    await Promise.resolve();
    expect(getByTestId('current-fen').textContent).toContain('4P3');
    expect(getByTestId('source').textContent).toContain('lichess');
  });
});
