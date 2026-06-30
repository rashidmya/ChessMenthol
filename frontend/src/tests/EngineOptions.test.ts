import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._a: unknown[]) => ({ name: 'X', option_lines: [] as string[] })),
  isTauriMock: vi.fn(() => true),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a), isTauri: () => isTauriMock() }));

import EngineOptions from '../components/EngineOptions.svelte';
import { setSchema, getOverrides } from '../lib/engineOptions';

const schema = [
  { name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 },
  { name: 'Ponder', type: 'check', default: 'false' },
  { name: 'Style', type: 'combo', default: 'Normal', vars: ['Solid', 'Normal'] },
  { name: 'Clear Hash', type: 'button' },
];

beforeEach(() => { localStorage.clear(); invokeMock.mockReset(); isTauriMock.mockReturnValue(true); });

describe('EngineOptions', () => {
  it('renders a control per option from the cached schema', async () => {
    setSchema('stockfish', schema as never);
    const { findByLabelText, getByText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand: vi.fn() } });
    expect(await findByLabelText('Threads')).toBeTruthy();      // spin → number
    expect(await findByLabelText('Ponder')).toBeTruthy();       // check → toggle
    expect(await findByLabelText('Style')).toBeTruthy();        // combo → select
    expect(getByText('Clear Hash')).toBeTruthy();               // button
  });

  it('editing a spin option stores the override and emits a command', async () => {
    setSchema('stockfish', schema as never);
    const onCommand = vi.fn();
    const { findByLabelText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand } });
    const input = (await findByLabelText('Threads')) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '4' } });
    await fireEvent.change(input);
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_engine_option', name: 'Threads', value: '4' });
    expect(getOverrides('stockfish')).toEqual({ Threads: '4' });
  });

  it('clamps a spin value to max', async () => {
    setSchema('stockfish', schema as never);
    const onCommand = vi.fn();
    const { findByLabelText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand } });
    const input = (await findByLabelText('Threads')) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '999' } });
    await fireEvent.change(input);
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_engine_option', name: 'Threads', value: '8' });
  });

  it('a button emits a valueless command', async () => {
    setSchema('stockfish', schema as never);
    const onCommand = vi.fn();
    const { getByText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand } });
    await fireEvent.click(getByText('Clear Hash'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_engine_option', name: 'Clear Hash' });
  });

  it('reset-all emits reset_engine_options', async () => {
    setSchema('stockfish', schema as never);
    const onCommand = vi.fn();
    const { getByText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand } });
    await fireEvent.click(getByText(/reset to defaults/i));
    expect(onCommand).toHaveBeenCalledWith({ type: 'reset_engine_options' });
  });

  it('fetches the schema when none is cached', async () => {
    invokeMock.mockResolvedValue({ name: 'X', option_lines: ['option name Threads type spin default 1 min 1 max 8'] });
    const { findByLabelText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand: vi.fn() } });
    expect(await findByLabelText('Threads')).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith('engine_probe', expect.anything());
  });

  it('the per-row reset button emits reset_engine_option', async () => {
    setSchema('stockfish', schema as never);
    const onCommand = vi.fn();
    const { findByLabelText, getByLabelText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand } });
    await findByLabelText('Threads');
    await fireEvent.click(getByLabelText('Reset Threads'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'reset_engine_option', name: 'Threads' });
  });

  it('toggling a check option maps to true/false and stores the override', async () => {
    setSchema('stockfish', schema as never);
    const onCommand = vi.fn();
    const { findByLabelText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand } });
    const box = (await findByLabelText('Ponder')) as HTMLInputElement;
    await fireEvent.change(box, { target: { checked: true } });
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_engine_option', name: 'Ponder', value: 'true' });
    expect(getOverrides('stockfish')).toEqual({ Ponder: 'true' });
  });

  it('shows "options unavailable" when no schema and not on Tauri', async () => {
    isTauriMock.mockReturnValue(false);
    const { findByText } = render(EngineOptions, { props: { engineId: 'stockfish', onCommand: vi.fn() } });
    expect(await findByText(/options unavailable/i)).toBeTruthy();
  });
});
