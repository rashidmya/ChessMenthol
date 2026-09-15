import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

// Browser stub WITH windows/tabs so Capture can ask the active tab first. (See
// Panel.test.ts for why this lives in vi.hoisted with a truthy runtime.id; the POS
// fixture lives INSIDE the block because vi.hoisted runs before every other top-level
// statement — a `const` declared above it would still be in its TDZ here.)
const h = vi.hoisted(() => {
  const POS = { kind: 'position', site: 'chesscom', fen: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1', orientation: 'white', turn: 'b' };
  // Controllable busy store + detect spy, shared with the tracker mock below.
  const subs = new Set<(v: boolean) => void>();
  let busyNow = false;
  const busy = {
    subscribe: (run: (v: boolean) => void) => { subs.add(run); run(busyNow); return () => { subs.delete(run); }; },
    set: (v: boolean) => { busyNow = v; subs.forEach((r) => r(v)); },
  };
  // detectError: when set, the mocked tracker throws it (the orchestrator wraps that as
  // `capture failed: …`, which panelStatus maps to capture_denied).
  const state = { reply: null as unknown, detect: 0, detectError: null as string | null };
  // runtime.sendMessage spy (the capture-request). A truthy data URL by default so the
  // panel's real requestCapture resolves and the mocked detect decides the outcome
  // (null -> no_board).
  const sendMessage = vi.fn(async (_m: unknown): Promise<unknown> => ({ dataUrl: 'data:,' }));
  // tabs.sendMessage spy (the position-request): resolves with `state.reply` at call time.
  const tabSend = vi.fn(async (..._a: unknown[]): Promise<unknown> => state.reply);
  vi.stubGlobal('browser', {
    runtime: {
      id: 'test-extension', getURL: (p: string) => p,
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: (m: unknown) => sendMessage(m),
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    windows: { getCurrent: async () => ({ id: 5 }), onFocusChanged: { addListener: () => {}, removeListener: () => {} }, WINDOW_ID_NONE: -1 },
    tabs: { query: async () => [{ id: 42 }], sendMessage: (...a: unknown[]) => tabSend(...a), onActivated: { addListener: () => {}, removeListener: () => {} } },
  });
  return { busy, state, POS, sendMessage, tabSend };
});
vi.mock('../engine/wasmEngine', () => ({ loadWasmEngine: async () => ({ send() {}, onLine() {}, dispose() {} }) }));
// The mocked tracker calls the panel's requestCapture from detectPosition the way the
// real TabCapturer.grab() does, so a Capture click reaches runtime.sendMessage and the
// capture-request it sends can be asserted.
vi.mock('../vision/visionTracker', () => ({ makeTabTracker: (requestCapture: () => Promise<string>) => ({
  detectPosition: async () => {
    h.state.detect++;
    await requestCapture();
    if (h.state.detectError) throw new Error(h.state.detectError);
    return null;
  },
  grabFullDesktop: async () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
  setRegion() {}, setSideOverride() {}, setOrientationOverride() {}, reset() {},
  busy: h.busy,
}) }));

import Panel from '../../entrypoints/sidepanel/Panel.svelte';
import { settings, DEFAULTS } from '../../src/lib/settings';

/** Drain the mount chain (hydrate -> windows.getCurrent -> …): every stub is
 *  microtask-based, so one macrotask settles it all. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('Panel capture', () => {
  // Live reading off so mount does not pull; Capture must still ask the tab.
  beforeEach(() => {
    settings.set({ ...DEFAULTS, liveSiteReading: false });
    h.state.reply = null; h.state.detect = 0; h.state.detectError = null; h.busy.set(false);
    h.sendMessage.mockClear(); h.tabSend.mockClear();
  });

  it('applies the site\'s DOM position when the active tab answers, without a screenshot', async () => {
    h.state.reply = h.POS;
    const { getByTestId } = render(Panel);
    await fireEvent.click(getByTestId('capture'));
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('3P4'));
    expect(getByTestId('source').textContent).toContain('chess.com');
    expect(h.state.detect).toBe(0);
  });

  it('falls back to the vision capture when no site position is available', async () => {
    const { getByTestId } = render(Panel);
    await fireEvent.click(getByTestId('capture'));
    await waitFor(() => expect(h.state.detect).toBe(1));
    expect(getByTestId('source').textContent).toContain('vision');
  });

  it('disables and relabels both Capture buttons while a capture is in flight', async () => {
    const { getByTestId } = render(Panel);
    await fireEvent.click(getByTestId('capture'));   // no site reply -> vision -> null -> no_board card
    await waitFor(() => getByTestId('status-capture'));
    h.busy.set(true);
    await waitFor(() => expect((getByTestId('capture') as HTMLButtonElement).disabled).toBe(true));
    expect(getByTestId('capture').textContent).toContain('Capturing');
    expect((getByTestId('status-capture') as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('status-capture').textContent).toContain('Capturing');
    h.busy.set(false);
    await waitFor(() => expect((getByTestId('capture') as HTMLButtonElement).disabled).toBe(false));
    expect((getByTestId('status-capture') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ignores a Capture click while a capture is already in flight (the busy guard)', async () => {
    h.state.reply = h.POS;   // a pull WOULD succeed, so any leak past the guard shows up
    const { getByTestId } = render(Panel);
    await settle();
    h.busy.set(true);
    await waitFor(() => expect((getByTestId('capture') as HTMLButtonElement).disabled).toBe(true));
    // fireEvent dispatches straight to the element (not element.click()), so jsdom still
    // runs the listener on the disabled button — the `$busy` guard is what must stop it.
    await fireEvent.click(getByTestId('capture'));
    await settle();
    expect(h.tabSend).not.toHaveBeenCalled();
    expect(h.state.detect).toBe(0);
    expect(getByTestId('current-fen').textContent).not.toContain('3P4');
  });

  it('shows the underlying reason on the capture-denied card', async () => {
    h.state.detectError = 'This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.';
    const { getByTestId } = render(Panel);
    await fireEvent.click(getByTestId('capture'));
    await waitFor(() => expect(getByTestId('status-card').textContent).toContain("Couldn't capture"));
    const reason = getByTestId('status-reason').textContent ?? '';
    expect(reason).toContain('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND');
    expect(reason).not.toMatch(/^capture failed/i);   // the orchestrator's prefix is stripped
  });

  it('sends the panel\'s window id with the capture request', async () => {
    const { getByTestId } = render(Panel);
    await settle();   // mount chain resolved -> myWindowId known
    await fireEvent.click(getByTestId('capture'));   // no site reply -> vision path
    await waitFor(() => expect(h.sendMessage).toHaveBeenCalledWith({ kind: 'capture-request', windowId: 5 }));
  });

  it('an explicit Capture re-applies an unchanged site position (bypasses the same-FEN guard)', async () => {
    h.state.reply = h.POS;   // black to move
    const { getByTestId } = render(Panel);
    await fireEvent.click(getByTestId('capture'));
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('3P4'));
    expect(getByTestId('current-fen').textContent).toContain(' b ');
    await fireEvent.click(getByTestId('turn-toggle'));   // user edits the board: now White to move
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain(' w '));
    await fireEvent.click(getByTestId('capture'));   // same site reply -> re-applied anyway
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain(' b '));
    expect(h.state.detect).toBe(0);
  });

  it('a double-click on a site tab never falls back to a screenshot (a superseded pull is not "no position")', async () => {
    h.state.reply = h.POS;
    const { getByTestId } = render(Panel);
    await settle();
    const btn = getByTestId('capture');
    // Two clicks in the same task: the first pull is superseded by the second before its
    // reply lands. NOT `await fireEvent.click` — that drains microtasks between the clicks.
    void fireEvent.click(btn); void fireEvent.click(btn);
    await settle(); await settle();
    expect(h.state.detect).toBe(0);
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(getByTestId('current-fen').textContent).toContain('3P4');
    expect(getByTestId('source').textContent).toContain('chess.com');
  });

  it('a later site/manual position clears a stale vision status card', async () => {
    const { getByTestId, queryByTestId } = render(Panel);
    await fireEvent.click(getByTestId('capture'));   // vision path; tracker returns null -> no_board
    await waitFor(() => expect(getByTestId('status-card').textContent).toContain('No chessboard'));
    h.state.reply = h.POS;
    await fireEvent.click(getByTestId('capture'));   // DOM path applies
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('3P4'));
    expect(queryByTestId('status-card')).toBeNull();
  });
});
