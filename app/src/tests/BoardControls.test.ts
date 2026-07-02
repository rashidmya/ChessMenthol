import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BoardControls from '../components/BoardControls.svelte';

describe('BoardControls', () => {
  it('emits turn + flip', async () => {
    const onSetTurn = vi.fn();
    const onFlip = vi.fn();
    const { getByText, getByTestId } = render(BoardControls, { props: { sideToMove: 'white', onSetTurn, onFlip } });
    await fireEvent.click(getByText('Black'));
    expect(onSetTurn).toHaveBeenCalledWith(false);
    await fireEvent.click(getByTestId('flip-btn'));
    expect(onFlip).toHaveBeenCalled();
  });
});
