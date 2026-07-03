import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('../lib/engineClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/engineClient')>();
  return { ...real, send: vi.fn() };
});

import App from '../App.svelte';
import { state } from '../lib/engineClient';

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

/** Render App and click Explore to reach the Analysis screen. */
async function renderAnalysis() {
  const utils = render(App);
  await fireEvent.click(screen.getByText('Explore'));
  return utils;
}

describe('App shell', () => {
  it('mounts without throwing and renders the board', () => {
    render(App);
    expect(screen.getByTestId('board')).toBeTruthy();
  });
});

describe('analysis-disabled gating', () => {
  beforeEach(() => { localStorage.clear(); });

  it('shows eval bar, engine lines, and move feedback when analysis is enabled and populated', async () => {
    await renderAnalysis();
    state.set(stateFrame({ analysisEnabled: true }) as never);
    await tick();
    expect(screen.getByTestId('evalbar')).toBeTruthy();
    expect(screen.getByTestId('lines')).toBeTruthy();
    expect(screen.getByTestId('feedback-section')).toBeTruthy();
    expect(screen.getByTestId('movefeedback')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View options' })).toBeTruthy();
  });

  it('hides the empty engine-lines and move-feedback sections (no empty dividers)', async () => {
    await renderAnalysis();
    state.set(stateFrame({ analysisEnabled: true, lines: [], lastMove: null }) as never);
    await tick();
    expect(screen.queryByTestId('lines')).toBeNull();
    expect(screen.queryByTestId('feedback-section')).toBeNull();
    expect(screen.getByTestId('evalbar')).toBeTruthy();
  });

  it('hides eval bar, engine lines, move feedback, and View options when analysis is disabled', async () => {
    await renderAnalysis();
    state.set(stateFrame({ analysisEnabled: false }) as never);
    await tick();
    expect(screen.queryByTestId('evalbar')).toBeNull();
    expect(screen.queryByTestId('lines')).toBeNull();
    expect(screen.queryByTestId('movefeedback')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View options' })).toBeNull();
    expect(screen.getByText('Analysis')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Engine settings' })).toBeTruthy();
  });

  it('drops the engine-header divider when analysis is disabled (no stray line under the header)', async () => {
    const { container } = await renderAnalysis();
    state.set(stateFrame({ analysisEnabled: false }) as never);
    await tick();
    expect(container.querySelector('.hd')?.classList.contains('divider')).toBe(false);
  });

  it('keeps the engine-header divider when analysis is enabled with lines below it', async () => {
    const { container } = await renderAnalysis();
    state.set(stateFrame({ analysisEnabled: true }) as never);
    await tick();
    expect(container.querySelector('.hd')?.classList.contains('divider')).toBe(true);
  });

  it('drops the engine-header divider when analysis is on but no lines are shown', async () => {
    const { container } = await renderAnalysis();
    state.set(stateFrame({ analysisEnabled: true, lines: [] }) as never);
    await tick();
    expect(container.querySelector('.hd')?.classList.contains('divider')).toBe(false);
  });
});

