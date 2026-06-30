import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

const { invokeMock, openMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._a: unknown[]) => ({ name: 'Komodo 14' })),
  openMock: vi.fn(async (..._a: unknown[]) => '/opt/engines/komodo' as string | null),
  isTauriMock: vi.fn(() => true),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a), isTauri: () => isTauriMock() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => openMock(...a) }));

import EngineList from '../components/EngineList.svelte';
import { list } from '../lib/engineRegistry';

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  openMock.mockReset();
  isTauriMock.mockReturnValue(true);
  invokeMock.mockResolvedValue({ name: 'Komodo 14' });
  openMock.mockResolvedValue('/opt/engines/komodo');
});

describe('EngineList', () => {
  it('renders the bundled Stockfish row with no remove control', () => {
    const { getByText, queryByLabelText } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine: vi.fn() } });
    expect(getByText('Stockfish 18')).toBeTruthy();
    expect(queryByLabelText('Remove Stockfish 18')).toBeNull();
  });

  it('hides "+ Add engine" in a plain browser', () => {
    isTauriMock.mockReturnValue(false);
    const { queryByText } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine: vi.fn() } });
    expect(queryByText('+ Add engine')).toBeNull();
  });

  it('clicking a row selects that engine', async () => {
    const { add } = await import('../lib/engineRegistry');
    add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/x' });
    const onSetEngine = vi.fn();
    const { getByText } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine } });
    await fireEvent.click(getByText('My Engine'));
    expect(onSetEngine).toHaveBeenCalledWith('ext1');
  });

  it('add flow: validates, adds + selects the engine', async () => {
    const onSetEngine = vi.fn();
    const { getByText } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine } });
    await fireEvent.click(getByText('+ Add engine'));
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('engine_validate', { path: '/opt/engines/komodo' }));
    await vi.waitFor(() => expect(onSetEngine).toHaveBeenCalledTimes(1));
    expect(list().some((e) => e.name === 'Komodo 14' && e.path === '/opt/engines/komodo')).toBe(true);
    const newId = onSetEngine.mock.calls[0][0];
    expect(newId).not.toBe('stockfish');
  });

  it('add failure surfaces an error and adds nothing', async () => {
    invokeMock.mockRejectedValue('not a uci engine');
    const onSetEngine = vi.fn();
    const { getByText, findByRole } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine } });
    await fireEvent.click(getByText('+ Add engine'));
    const alert = await findByRole('alert');
    expect(alert.textContent).toMatch(/isn't a working UCI engine/i);
    expect(onSetEngine).not.toHaveBeenCalled();
    expect(list()).toHaveLength(1); // only bundled
  });

  it('auto-dismisses the add error after a few seconds', async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockRejectedValue('not a uci engine');
      const { getByText, queryByRole } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine: vi.fn() } });
      await fireEvent.click(getByText('+ Add engine'));
      // Flush the async add flow (open → invoke reject → catch) so the alert renders.
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await tick();
      expect(queryByRole('alert')).not.toBeNull();
      // The error clears itself once the auto-dismiss timer elapses.
      await vi.advanceTimersByTimeAsync(3000);
      expect(queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelling the picker adds nothing', async () => {
    openMock.mockResolvedValue(null);
    const onSetEngine = vi.fn();
    const { getByText } = render(EngineList, { props: { engineId: 'stockfish', onSetEngine } });
    await fireEvent.click(getByText('+ Add engine'));
    await vi.waitFor(() => expect(openMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onSetEngine).not.toHaveBeenCalled();
    expect(list()).toHaveLength(1);
  });

  it('removing the selected external engine falls back to bundled', async () => {
    const { add } = await import('../lib/engineRegistry');
    add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/x' });
    const onSetEngine = vi.fn();
    const { getByLabelText } = render(EngineList, { props: { engineId: 'ext1', onSetEngine } });
    await fireEvent.click(getByLabelText('Remove My Engine'));
    expect(onSetEngine).toHaveBeenCalledWith('stockfish');
    expect(list().some((e) => e.id === 'ext1')).toBe(false);
  });
});
