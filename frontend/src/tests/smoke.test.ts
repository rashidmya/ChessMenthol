import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import App from '../App.svelte';
import { state } from '../lib/ws';

function stateFrame(overrides: Record<string, unknown> = {}) {
  return {
    type: 'state',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    sideToMove: 'white', engineId: 'stockfish', analyzing: false,
    eval: { cp: 20, mate: null, text: '+0.20' }, depth: 12,
    lines: [{ multipv: 1, scoreText: '+0.20', cp: 20, mate: null, pv: [], san: '1.e4' }],
    lastMove: {
      classification: { label: 'good', cpl: 10, isBest: false },
      played: { san: 'e4', uci: 'e2e4', evalText: '+0.20', pv: '' },
      best: { san: 'd4', uci: 'd2d4', evalText: '+0.25', pv: '' },
    },
    visionStatus: 'idle', detectedOrientation: null, lowConfidence: [], region: null,
    moveList: [{ ply: 1, san: 'e4', uci: 'e2e4', classification: { label: 'good', cpl: 10, isBest: false } }],
    currentPly: 1, analysisEnabled: true, movetime: 10000,
    ...overrides,
  };
}

// jsdom WebSocket may throw on an invalid URL (about:blank → "ws:///ws").
// Stub it as a silent no-op so onMount's connect() doesn't throw.
beforeAll(() => {
  vi.stubGlobal('WebSocket', class {
    constructor(_url: string) {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
    readyState = 0;
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
  });
});

describe('App shell', () => {
  it('mounts without throwing and renders the board', () => {
    render(App);
    expect(screen.getByTestId('board')).toBeTruthy();
  });

  it('renders the analysis card with EngineHeader', () => {
    render(App);
    // EngineHeader renders <span class="txt">Analysis</span> unconditionally
    expect(screen.getByText('Analysis')).toBeTruthy();
  });

  it('renders the ChessMenthol brand from Header', () => {
    render(App);
    // Header renders <h1>Chess<i>Menthol</i></h1>; h1 textContent is "ChessMenthol"
    expect(screen.getByRole('heading', { name: /chessMenthol/i })).toBeTruthy();
  });
});

describe('analysis-disabled gating', () => {
  beforeEach(() => { localStorage.clear(); state.set(null); });

  it('shows eval bar, engine lines, and move feedback when analysis is enabled and populated', async () => {
    render(App);
    state.set(stateFrame({ analysisEnabled: true }) as never);
    await tick();
    expect(screen.getByTestId('evalbar')).toBeTruthy();
    expect(screen.getByTestId('lines')).toBeTruthy();
    expect(screen.getByTestId('feedback-section')).toBeTruthy();
    expect(screen.getByTestId('movefeedback')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View options' })).toBeTruthy();
  });

  it('hides the empty engine-lines and move-feedback sections (no empty dividers)', async () => {
    render(App);
    // analysis on, but no lines computed yet and no move played yet
    state.set(stateFrame({ analysisEnabled: true, lines: [], lastMove: null }) as never);
    await tick();
    expect(screen.queryByTestId('lines')).toBeNull();
    expect(screen.queryByTestId('feedback-section')).toBeNull();
    // the eval bar and the move-history section still render
    expect(screen.getByTestId('evalbar')).toBeTruthy();
  });

  it('hides eval bar, engine lines, move feedback, and View options when analysis is disabled', async () => {
    render(App);
    state.set(stateFrame({ analysisEnabled: false }) as never);
    await tick();
    expect(screen.queryByTestId('evalbar')).toBeNull();
    expect(screen.queryByTestId('lines')).toBeNull();
    expect(screen.queryByTestId('movefeedback')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View options' })).toBeNull();
    // The Analysis switch (to re-enable) and the move history remain.
    expect(screen.getByText('Analysis')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Engine settings' })).toBeTruthy();
  });
});

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
