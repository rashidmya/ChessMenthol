import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

// A browser stub WITH windows/tabs so the panel runs its affinity + handshake code.
// (See Panel.test.ts for why this must live in vi.hoisted with a truthy runtime.id.)
// The POS_* fixtures live INSIDE the hoisted block: vi.hoisted runs before every other
// top-level statement, so a `const` declared above it would still be in its TDZ here.
const h = vi.hoisted(() => {
  const POS_E4 = { kind: 'position', site: 'lichess', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', orientation: 'white', turn: 'b' };
  const POS_D4 = { kind: 'position', site: 'chesscom', fen: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1', orientation: 'black', turn: 'b' };
  const listeners: ((m: unknown, sender?: unknown) => void)[] = [];
  const activated: ((info: { tabId: number; windowId: number }) => void)[] = [];
  const focused: ((windowId: number) => void)[] = [];
  const removeActivated = vi.fn();
  const removeFocus = vi.fn();
  // `tabs.sendMessage` stand-in: resolves with `state.reply` at call time — or, when
  // `state.pending` is an array, parks the reply's resolver there so a test can settle
  // requests in any order it likes.
  const state = {
    reply: POS_E4 as unknown,
    pending: null as ((v: unknown) => void)[] | null,
    sendMessage: vi.fn((..._a: unknown[]): Promise<unknown> => {
      const q = state.pending;
      return q ? new Promise<unknown>((resolve) => q.push(resolve)) : Promise.resolve(state.reply);
    }),
  };
  vi.stubGlobal('browser', {
    runtime: {
      id: 'test-extension', getURL: (p: string) => p,
      onMessage: { addListener: (f: (m: unknown, s?: unknown) => void) => listeners.push(f), removeListener: () => {} },
      sendMessage: async () => ({ dataUrl: null }),
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    windows: {
      getCurrent: async () => ({ id: 5 }),
      onFocusChanged: { addListener: (f: (id: number) => void) => focused.push(f), removeListener: removeFocus },
      WINDOW_ID_NONE: -1,
    },
    tabs: {
      query: async () => [{ id: 42 }],
      sendMessage: (...a: unknown[]) => state.sendMessage(...a),
      onActivated: { addListener: (f: (i: { tabId: number; windowId: number }) => void) => activated.push(f), removeListener: removeActivated },
    },
  });
  return { listeners, activated, focused, removeActivated, removeFocus, state, POS_E4, POS_D4 };
});
vi.mock('../engine/wasmEngine', () => ({ loadWasmEngine: async () => ({ send() {}, onLine() {}, dispose() {} }) }));
vi.mock('../vision/visionTracker', () => ({ makeTabTracker: () => ({
  detectPosition: async () => null, grabFullDesktop: async () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
  setRegion() {}, setSideOverride() {}, setOrientationOverride() {}, reset() {},
  busy: { subscribe: (run: (v: boolean) => void) => { run(false); return () => {}; } },
}) }));

import Panel from '../../entrypoints/sidepanel/Panel.svelte';
import { settings, DEFAULTS } from '../../src/lib/settings';

/** Drain the whole mount chain (hydrate -> storage.get -> windows.getCurrent -> tabs.query
 *  -> tabs.sendMessage): every stub is microtask-based, so one macrotask settles it all. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('Panel handshake + tab affinity', () => {
  beforeEach(() => {
    h.listeners.length = 0; h.activated.length = 0; h.focused.length = 0;
    h.state.reply = h.POS_E4; h.state.pending = null; h.state.sendMessage.mockClear();
    h.removeActivated.mockClear(); h.removeFocus.mockClear();
    settings.set({ ...DEFAULTS });
  });

  it('requests the active tab\'s position on mount and shows it', async () => {
    const { getByTestId } = render(Panel);
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
    expect(h.state.sendMessage).toHaveBeenCalledWith(42, { kind: 'position-request' });
    expect(getByTestId('source').textContent).toContain('lichess');
  });

  it('ignores a pushed position from a tab that is not the active one in this window', async () => {
    const { getByTestId } = render(Panel);
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
    h.listeners.forEach((f) => f(h.POS_D4, { tab: { active: false, windowId: 5 } }));
    await Promise.resolve();
    expect(getByTestId('current-fen').textContent).toContain('4P3');   // unchanged
    h.listeners.forEach((f) => f(h.POS_D4, { tab: { active: true, windowId: 5 } }));
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('3P4'));
  });

  it('re-requests when the active tab of this window changes', async () => {
    const { getByTestId } = render(Panel);
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
    h.state.reply = h.POS_D4;
    h.activated.forEach((f) => f({ tabId: 43, windowId: 5 }));
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('3P4'));
  });

  it('a stale reply from a superseded pull cannot overwrite the newer tab\'s board', async () => {
    const { getByTestId } = render(Panel);
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
    h.state.pending = [];
    h.activated.forEach((f) => f({ tabId: 43, windowId: 5 }));   // pull #1 (old tab)
    h.activated.forEach((f) => f({ tabId: 44, windowId: 5 }));   // pull #2 (current tab)
    await waitFor(() => expect(h.state.pending).toHaveLength(2));
    h.state.pending[1](h.POS_D4);   // the current tab answers first ...
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('3P4'));
    h.state.pending[0](h.POS_E4);   // ... then the old tab's reply lands late
    await settle();
    expect(getByTestId('current-fen').textContent).toContain('3P4');   // still the current tab
  });

  it('a re-read of the same site position (window refocus) does not reset the board', async () => {
    const { getByTestId } = render(Panel);
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
    expect(getByTestId('current-fen').textContent).toContain(' b ');
    await fireEvent.click(getByTestId('turn-toggle'));   // user edits the board: now White to move
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain(' w '));
    h.focused.forEach((f) => f(5));   // alt-tab back -> re-pull; the site still answers POS_E4
    await settle();
    expect(h.state.sendMessage).toHaveBeenCalledTimes(2);   // mount pull + refocus pull
    expect(getByTestId('current-fen').textContent).toContain(' w ');   // guarded: not re-applied
    // A pasted FEN is "diverged from the site" exactly like a manual line: the guard holds
    // across a refocus that returns the unchanged site position ...
    await fireEvent.click(getByTestId('fen-toggle'));
    await fireEvent.input(getByTestId('fen-input'), { target: { value: '8/8/8/8/8/8/8/4K2k w - - 0 1' } });
    await fireEvent.click(getByTestId('load-fen'));
    expect(getByTestId('current-fen').textContent).toContain('4K2k');
    h.focused.forEach((f) => f(5));
    await settle();
    expect(h.state.sendMessage).toHaveBeenCalledTimes(3);
    expect(getByTestId('current-fen').textContent).toContain('4K2k');   // kept
    // ... and only a genuinely NEW site position replaces it.
    h.state.reply = h.POS_D4;
    h.focused.forEach((f) => f(5));
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('3P4'));
    expect(getByTestId('current-fen').textContent).toContain(' b ');
  });

  it('does not request while Live site reading is off, and requests when it is turned on', async () => {
    settings.set({ ...DEFAULTS, liveSiteReading: false });
    const { getByTestId } = render(Panel);
    await settle();
    expect(h.state.sendMessage).not.toHaveBeenCalled();
    await fireEvent.click(getByTestId('toggle-live-main'));
    await waitFor(() => expect(h.state.sendMessage).toHaveBeenCalledWith(42, { kind: 'position-request' }));
    expect(h.state.sendMessage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
  });

  it('does not re-request on tab activation while Live site reading is off', async () => {
    settings.set({ ...DEFAULTS, liveSiteReading: false });
    render(Panel);
    await settle();
    expect(h.activated).toHaveLength(1);   // the affinity subscription itself is still made
    h.activated.forEach((f) => f({ tabId: 43, windowId: 5 }));
    await settle();
    expect(h.state.sendMessage).not.toHaveBeenCalled();
  });

  it('unsubscribes from tab-activation and window-focus events on unmount', async () => {
    const { getByTestId, unmount } = render(Panel);
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
    unmount();
    expect(h.removeActivated).toHaveBeenCalledTimes(1);
    expect(h.removeActivated).toHaveBeenCalledWith(h.activated[0]);
    expect(h.removeFocus).toHaveBeenCalledTimes(1);
    expect(h.removeFocus).toHaveBeenCalledWith(h.focused[0]);
  });
});
