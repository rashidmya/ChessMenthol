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

  it('Region button calls onPickRegion', async () => {
    const onPickRegion = vi.fn();
    const { getByTestId } = render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish',
      analyzing: true, fen: 'startpos', onCommand: vi.fn(), onPickRegion } as any });
    await fireEvent.click(getByTestId('region-btn'));
    expect(onPickRegion).toHaveBeenCalled();
  });

  it('Clear button appears with a region and emits clear_region', async () => {
    const onCommand = vi.fn();
    const { getByTestId } = render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish',
      analyzing: true, fen: 'startpos', onCommand,
      region: { left: 1, top: 1, width: 10, height: 10 } } as any });
    await fireEvent.click(getByTestId('clear-region-btn'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'clear_region' });
  });

  it('hides Clear when no region is set', () => {
    const { queryByTestId } = render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish',
      analyzing: true, fen: 'startpos', onCommand: vi.fn(), region: null } as any });
    expect(queryByTestId('clear-region-btn')).toBeNull();
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
