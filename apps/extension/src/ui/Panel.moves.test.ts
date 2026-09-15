import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

// Fake browser (see Panel.position.test.ts for why this must be `vi.hoisted`). Collects
// the panel's runtime.onMessage listeners so a test can push site positions at it; there
// is no `windows`/`tabs`, so affinity is off and every push is accepted.
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
  busy: { subscribe: (run: (v: boolean) => void) => { run(false); return () => {}; } },
}) }));
// Swap the real chessground board for a stub whose buttons call onMove(uci).
vi.mock('../../entrypoints/sidepanel/components/Board.svelte', async () => ({
  default: (await import('./__fixtures__/BoardStub.svelte')).default,
}));

import Panel from '../../entrypoints/sidepanel/Panel.svelte';
import { settings, DEFAULTS } from '../../src/lib/settings';

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('Panel manual moves', () => {
  beforeEach(() => { listeners.length = 0; settings.set({ ...DEFAULTS, liveSiteReading: false }); });

  it('plays a legal board move: position, turn, source, last-move highlight, history UI', async () => {
    const { getByTestId, queryByTestId } = render(Panel);
    expect(queryByTestId('move-stepper')).toBeNull();
    await fireEvent.click(getByTestId('stub-move-e2e4'));
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
    expect(getByTestId('current-fen').textContent).toContain(' b ');
    expect(getByTestId('source').textContent).toContain('manual');
    expect(getByTestId('board').getAttribute('data-lastmove')).toBe('e2e4');
    expect(getByTestId('move-stepper')).toBeInTheDocument();
    expect(getByTestId('move-1').textContent).toContain('e4');
    expect(getByTestId('move-1').classList.contains('current')).toBe(true);
  });

  it('steps back (undo) and forward through the played moves', async () => {
    const { getByTestId, getByRole } = render(Panel);
    await fireEvent.click(getByTestId('stub-move-e2e4'));
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
    await fireEvent.click(getByRole('button', { name: 'Previous move' }));
    await waitFor(() => expect(getByTestId('current-fen').textContent).not.toContain('4P3'));
    expect(getByTestId('board').getAttribute('data-lastmove')).toBe('');
    expect(getByTestId('move-1').classList.contains('current')).toBe(false);
    // Clicking a move in the list navigates too (Panel's onNavigate reaches MoveList).
    await fireEvent.click(getByTestId('move-1'));
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
    expect(getByTestId('move-1').classList.contains('current')).toBe(true);
    await fireEvent.click(getByRole('button', { name: 'Previous move' }));
    await waitFor(() => expect(getByTestId('current-fen').textContent).not.toContain('4P3'));
    await fireEvent.click(getByRole('button', { name: 'Next move' }));
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
  });

  it('an illegal move bumps revertSignal and leaves the position alone', async () => {
    const { getByTestId } = render(Panel);
    const before = getByTestId('board').getAttribute('data-revert');
    await fireEvent.click(getByTestId('stub-move-illegal'));
    await waitFor(() => expect(getByTestId('board').getAttribute('data-revert')).not.toBe(before));
    expect(getByTestId('current-fen').textContent).toContain('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
  });

  it('a same-FEN site re-read keeps the manual line; a new site position replaces it', async () => {
    settings.set({ ...DEFAULTS, liveSiteReading: true });
    const { getByTestId, queryByTestId } = render(Panel);
    const push = (fen: string) => listeners.forEach((f) => f({ kind: 'position', site: 'lichess', fen, orientation: 'white', turn: fen.split(' ')[1] }));
    push(STARTPOS);
    await waitFor(() => expect(getByTestId('source').textContent).toContain('lichess'));
    expect(getByTestId('current-fen').textContent).toContain(STARTPOS);
    await fireEvent.click(getByTestId('stub-move-e2e4'));
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('4P3'));
    expect(getByTestId('move-stepper')).toBeInTheDocument();
    expect(getByTestId('move-1')).toBeInTheDocument();
    expect(getByTestId('source').textContent).toContain('manual');
    // Same site position re-read (window refocus / tab re-activation): the manual line survives.
    push(STARTPOS);
    await Promise.resolve();
    expect(getByTestId('current-fen').textContent).toContain('4P3');
    expect(getByTestId('move-1')).toBeInTheDocument();
    // A genuinely NEW site position (after 1.d4) replaces the history.
    push('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1');
    await waitFor(() => expect(getByTestId('current-fen').textContent).toContain('3P4'));
    expect(queryByTestId('move-stepper')).toBeNull();
    expect(getByTestId('source').textContent).toContain('lichess');
  });
});
