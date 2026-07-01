import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

// Replace only `send` so transitions don't drive the real engine; keep the real stores.
vi.mock('../lib/engineClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/engineClient')>();
  return { ...real, send: vi.fn() };
});

import App from '../App.svelte';
import { send, report as reportStore } from '../lib/engineClient';
const sendMock = send as unknown as ReturnType<typeof vi.fn>;

describe('App screen routing', () => {
  beforeEach(() => sendMock.mockClear());

  it('starts on the Home panel', () => {
    render(App);
    expect(screen.getByTestId('home-panel')).toBeTruthy();
    expect(screen.queryByTestId('analysis-card')).toBeNull();
    expect(screen.queryByTestId('edit-panel')).toBeNull();
  });

  it('Explore enters Analysis and enables the engine', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Explore'));
    expect(screen.getByTestId('analysis-card')).toBeTruthy();
    expect(screen.queryByTestId('home-panel')).toBeNull();
    expect(sendMock).toHaveBeenCalledWith({ type: 'set_analysis_enabled', enabled: true });
  });

  it('Start Analysis loads a pasted FEN then enters Analysis', async () => {
    render(App);
    await fireEvent.input(screen.getByPlaceholderText(/Paste your FEN/),
      { target: { value: '8/8/8/8/8/8/8/8 w - - 0 1' } });
    await fireEvent.click(screen.getByText('Start Analysis'));
    expect(sendMock).toHaveBeenCalledWith({ type: 'set_fen', fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
    expect(sendMock).toHaveBeenCalledWith({ type: 'set_analysis_enabled', enabled: true });
    expect(screen.getByTestId('analysis-card')).toBeTruthy();
  });

  it('Set Up Position enters the editor; Back returns Home', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Set Up Position'));
    expect(screen.getByTestId('edit-panel')).toBeTruthy();
    await fireEvent.click(screen.getByTestId('edit-back'));
    expect(screen.getByTestId('home-panel')).toBeTruthy();
  });

  it('New from Analysis returns Home, resets, and disables the engine', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Explore'));
    await fireEvent.click(screen.getByText('New'));
    expect(screen.getByTestId('home-panel')).toBeTruthy();
    expect(sendMock).toHaveBeenCalledWith({ type: 'set_analysis_enabled', enabled: false });
    expect(sendMock).toHaveBeenCalledWith({ type: 'reset' });
  });
});

describe('App report flow', () => {
  beforeEach(() => {
    sendMock.mockClear();
    reportStore.set(null);
  });

  it('shows a Request-computer-analysis trigger once in analysis', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Explore'));
    expect(screen.queryByTestId('request-analysis')).toBeTruthy();
  });

  it('switches to the report screen when a report arrives', async () => {
    render(App);
    await fireEvent.click(screen.getByText('Explore'));
    reportStore.set({
      white: { accuracy: 90, acpl: 20, inaccuracy: 0, mistake: 0, blunder: 0 },
      black: { accuracy: 80, acpl: 30, inaccuracy: 0, mistake: 0, blunder: 0 },
      startWin: 51, plies: [],
    });
    await Promise.resolve();
    expect(screen.queryByTestId('report-panel')).toBeTruthy();
  });
});
