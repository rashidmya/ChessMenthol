import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import TurnToggle from '../components/TurnToggle.svelte';

describe('TurnToggle', () => {
  it('toggles the side to move and reflects aria-checked', async () => {
    const onSetTurn = vi.fn();
    const { getByTestId, rerender } = render(TurnToggle, { props: { sideToMove: 'white', onSetTurn } });
    const t = getByTestId('turn-toggle');
    expect(t.getAttribute('role')).toBe('switch');
    expect(t.getAttribute('aria-checked')).toBe('false');      // white to move
    await fireEvent.click(t);
    expect(onSetTurn).toHaveBeenCalledWith(false);             // white → black

    await rerender({ sideToMove: 'black', onSetTurn });
    const t2 = getByTestId('turn-toggle');
    expect(t2.getAttribute('aria-checked')).toBe('true');       // black to move
    await fireEvent.click(t2);
    expect(onSetTurn).toHaveBeenCalledWith(true);              // black → white
  });
});
