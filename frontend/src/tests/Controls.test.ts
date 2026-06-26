import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Controls from '../components/Controls.svelte';

function setup() {
  const onCommand = vi.fn();
  render(Controls, { sideToMove: 'white', engineId: 'stockfish', analyzing: true,
    fen: 'startpos', onCommand });
  return { onCommand };
}

describe('Controls', () => {
  it('emits set_turn when a turn button is clicked', async () => {
    const { onCommand } = setup();
    await fireEvent.click(screen.getByTestId('turn-black'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_turn', white: false });
  });

  it('emits set_engine when the engine is changed', async () => {
    const { onCommand } = setup();
    await fireEvent.change(screen.getByTestId('engine-select'), { target: { value: 'stockfish_lite' } });
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_engine', id: 'stockfish_lite' });
  });

  it('emits set_options with multipv when lines is changed', async () => {
    const { onCommand } = setup();
    await fireEvent.change(screen.getByTestId('lines-input'), { target: { value: '4' } });
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', multipv: 4 });
  });

  it('emits stop when stop is clicked', async () => {
    const { onCommand } = setup();
    await fireEvent.click(screen.getByTestId('stop-btn'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'stop' });
  });

  it('region-btn remains disabled', () => {
    setup();
    expect((screen.getByTestId('region-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Auto button is enabled and emits set_auto', async () => {
    const onCommand = vi.fn();
    const { getByTestId } = render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish',
      analyzing: true, fen: 'startpos', onCommand, tracking: false } as any });
    const btn = getByTestId('auto-btn');
    expect(btn).not.toBeDisabled();
    await fireEvent.click(btn);
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_auto', on: true });
  });

  it('Capture button emits capture_now', async () => {
    const onCommand = vi.fn();
    const { getByTestId } = render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish',
      analyzing: true, fen: 'startpos', onCommand } as any });
    await fireEvent.click(getByTestId('capture-btn'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'capture_now' });
  });

  it('emits set_fen with the typed FEN when Set is clicked', async () => {
    const { onCommand } = setup();
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    await fireEvent.input(screen.getByTestId('fen-input'), { target: { value: fen } });
    await fireEvent.click(screen.getByTestId('fen-set'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_fen', fen });
  });

  it('Edit button calls onToggleEdit', async () => {
    const onToggleEdit = vi.fn();
    render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish', analyzing: true,
      fen: 'startpos', onCommand: vi.fn(), onToggleEdit } as any });
    await fireEvent.click(screen.getByTestId('edit-btn'));
    expect(onToggleEdit).toHaveBeenCalled();
  });

  it('Threads input emits set_options', async () => {
    const { onCommand } = setup();
    await fireEvent.change(screen.getByTestId('threads-input'), { target: { value: '4' } });
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', threads: 4 });
  });

  it('Hash input emits set_options', async () => {
    const { onCommand } = setup();
    await fireEvent.change(screen.getByTestId('hash-input'), { target: { value: '512' } });
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', hash: 512 });
  });

  it('Arrows toggle calls onToggleArrows', async () => {
    const onToggleArrows = vi.fn();
    render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish', analyzing: true,
      fen: 'startpos', onCommand: vi.fn(), onToggleArrows } as any });
    await fireEvent.click(screen.getByTestId('arrows-toggle'));
    expect(onToggleArrows).toHaveBeenCalled();
  });

  it('Eval-bar toggle calls onToggleEvalBar', async () => {
    const onToggleEvalBar = vi.fn();
    render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish', analyzing: true,
      fen: 'startpos', onCommand: vi.fn(), onToggleEvalBar } as any });
    await fireEvent.click(screen.getByTestId('eval-toggle'));
    expect(onToggleEvalBar).toHaveBeenCalled();
  });
});
