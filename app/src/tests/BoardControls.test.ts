import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BoardControls from '../components/BoardControls.svelte';

describe('BoardControls', () => {
  it('emits turn + flip', async () => {
    const onSetTurn = vi.fn();
    const onFlip = vi.fn();
    const { getByTestId } = render(BoardControls, { props: { sideToMove: 'white', onSetTurn, onFlip } });
    await fireEvent.click(getByTestId('turn-seg').querySelector('[data-turn="b"]')!);
    expect(onSetTurn).toHaveBeenCalledWith(false);
    await fireEvent.click(getByTestId('flip-btn'));
    expect(onFlip).toHaveBeenCalled();
  });

  it('marks the active board side', () => {
    const { getByTestId } = render(BoardControls, { props: { boardSide: 'black' } });
    const seg = getByTestId('side-seg');
    expect(seg.querySelector('[data-side="black"]')!.classList.contains('on')).toBe(true);
  });

  it('sends the chosen board side on click', async () => {
    const onSetBoardSide = vi.fn();
    const { getByTestId } = render(BoardControls, { props: { boardSide: 'auto', onSetBoardSide } });
    const seg = getByTestId('side-seg');
    await fireEvent.click(seg.querySelector('[data-side="black"]')!);
    expect(onSetBoardSide).toHaveBeenCalledWith('black');
  });
});
