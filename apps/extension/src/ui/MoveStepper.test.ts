import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MoveStepper from '../../entrypoints/sidepanel/MoveStepper.svelte';

describe('MoveStepper', () => {
  it('navigates first/prev/next/last', async () => {
    const onNavigate = vi.fn();
    const { getAllByRole } = render(MoveStepper, { props: { currentPly: 3, total: 8, onNavigate } });
    const btns = getAllByRole('button');
    expect(btns).toHaveLength(4);
    await fireEvent.click(btns[0]); expect(onNavigate).toHaveBeenCalledWith(0);
    await fireEvent.click(btns[1]); expect(onNavigate).toHaveBeenCalledWith(2);
    await fireEvent.click(btns[2]); expect(onNavigate).toHaveBeenCalledWith(4);
    await fireEvent.click(btns[3]); expect(onNavigate).toHaveBeenCalledWith(8);
  });
  it('disables back at the start and forward at the end', async () => {
    const { getAllByRole, rerender } = render(MoveStepper, { props: { currentPly: 0, total: 4, onNavigate: () => {} } });
    let b = getAllByRole('button') as HTMLButtonElement[];
    expect(b[0].disabled && b[1].disabled).toBe(true);
    expect(b[2].disabled || b[3].disabled).toBe(false);
    await rerender({ currentPly: 4, total: 4, onNavigate: () => {} });
    b = getAllByRole('button') as HTMLButtonElement[];
    expect(b[2].disabled && b[3].disabled).toBe(true);
  });
});
