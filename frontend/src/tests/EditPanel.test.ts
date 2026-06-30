import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import EditPanel from '../components/EditPanel.svelte';

const base = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  side: 'white' as const,
  castle: { K: true, Q: true, k: true, q: true },
  selected: 'P',
};

describe('EditPanel', () => {
  it('renders palette, side select, FEN value, and Load', () => {
    const { getByTestId, getByText, getByDisplayValue } = render(EditPanel, { props: base });
    expect(getByTestId('edit-palette')).toBeTruthy();
    expect(getByTestId('side-select')).toBeTruthy();
    expect(getByDisplayValue(base.fen)).toBeTruthy();
    expect(getByText('Load')).toBeTruthy();
  });

  it('emits onSide(false) when switched to Black to move', async () => {
    const onSide = vi.fn();
    const { getByTestId } = render(EditPanel, { props: { ...base, onSide } });
    await fireEvent.change(getByTestId('side-select'), { target: { value: 'black' } });
    expect(onSide).toHaveBeenCalledWith(false);
  });

  it('emits onToggleCastle for a castling checkbox', async () => {
    const onToggleCastle = vi.fn();
    const { getByTestId } = render(EditPanel, { props: { ...base, onToggleCastle } });
    await fireEvent.click(getByTestId('castle-K'));
    expect(onToggleCastle).toHaveBeenCalledWith('K');
  });

  it('emits onFenInput when the FEN field is edited', async () => {
    const onFenInput = vi.fn();
    const { getByTestId } = render(EditPanel, { props: { ...base, onFenInput } });
    await fireEvent.input(getByTestId('edit-fen'), { target: { value: '8/8/8/8/8/8/8/8 w - - 0 1' } });
    expect(onFenInput).toHaveBeenCalledWith('8/8/8/8/8/8/8/8 w - - 0 1');
  });

  it('emits onFlip / onReset / onClear / onLoad / onBack', async () => {
    const fns = { onFlip: vi.fn(), onReset: vi.fn(), onClear: vi.fn(), onLoad: vi.fn(), onBack: vi.fn() };
    const { getByTestId, getByText } = render(EditPanel, { props: { ...base, ...fns } });
    await fireEvent.click(getByTestId('edit-flip')); expect(fns.onFlip).toHaveBeenCalled();
    await fireEvent.click(getByTestId('edit-reset')); expect(fns.onReset).toHaveBeenCalled();
    await fireEvent.click(getByTestId('edit-clear')); expect(fns.onClear).toHaveBeenCalled();
    await fireEvent.click(getByText('Load')); expect(fns.onLoad).toHaveBeenCalled();
    await fireEvent.click(getByTestId('edit-back')); expect(fns.onBack).toHaveBeenCalled();
  });

  it('shows an edit error when provided', () => {
    const { getByText } = render(EditPanel, { props: { ...base, editError: 'Need exactly one white and one black king.' } });
    expect(getByText('Need exactly one white and one black king.')).toBeTruthy();
  });
});
