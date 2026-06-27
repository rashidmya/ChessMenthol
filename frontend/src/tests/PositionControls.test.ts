import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import PositionControls from '../components/PositionControls.svelte';
describe('PositionControls', () => {
  it('sets FEN, resets, and toggles edit', async () => {
    const onCommand = vi.fn(); const onToggleEdit = vi.fn();
    const { getByPlaceholderText, getByText } = render(PositionControls, { props: { editing: false, onCommand, onToggleEdit } });
    await fireEvent.input(getByPlaceholderText('paste FEN…'), { target: { value: '8/8/8/8/8/8/8/8 w - - 0 1' } });
    await fireEvent.click(getByText('Set'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_fen', fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
    await fireEvent.click(getByText('Reset Board'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'reset' });
    await fireEvent.click(getByText('Edit Board')); expect(onToggleEdit).toHaveBeenCalled();
  });
  it('shows Done while editing', () => {
    const { getByText } = render(PositionControls, { props: { editing: true, onCommand: vi.fn(), onToggleEdit: vi.fn() } });
    expect(getByText('Done')).toBeTruthy();
  });
});
