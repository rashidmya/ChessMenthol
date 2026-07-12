import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BoardControls from '../components/BoardControls.svelte';

describe('BoardControls', () => {
  it('emits turn (via the pawn toggle) + flip', async () => {
    const onSetTurn = vi.fn();
    const onFlip = vi.fn();
    const { getByTestId } = render(BoardControls, { props: { sideToMove: 'white', onSetTurn, onFlip } });
    await fireEvent.click(getByTestId('turn-toggle'));
    expect(onSetTurn).toHaveBeenCalledWith(false);   // white → black
    await fireEvent.click(getByTestId('flip-btn'));
    expect(onFlip).toHaveBeenCalled();
  });
});
