import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Panel from '../../entrypoints/sidepanel/Panel.svelte';

describe('Panel', () => {
  it('renders a board and a FEN input', () => {
    const { getByTestId } = render(Panel);
    expect(getByTestId('fen-input')).toBeInTheDocument();
    expect(getByTestId('board')).toBeInTheDocument();
  });

  it('updates the shown FEN when the user submits one', async () => {
    const { getByTestId } = render(Panel);
    const input = getByTestId('fen-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '8/8/8/8/8/8/8/4K2k w - - 0 1' } });
    await fireEvent.click(getByTestId('load-fen'));
    expect(getByTestId('current-fen').textContent).toContain('4K2k');
  });
});
