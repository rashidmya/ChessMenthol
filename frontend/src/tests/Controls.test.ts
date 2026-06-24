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

  it('disables the Source section controls', () => {
    setup();
    expect((screen.getByTestId('capture-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('emits set_fen with the typed FEN when Set is clicked', async () => {
    const { onCommand } = setup();
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    await fireEvent.input(screen.getByTestId('fen-input'), { target: { value: fen } });
    await fireEvent.click(screen.getByTestId('fen-set'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_fen', fen });
  });
});
