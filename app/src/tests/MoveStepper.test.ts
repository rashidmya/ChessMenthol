import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MoveStepper from '../components/MoveStepper.svelte';

describe('MoveStepper', () => {
  it('navigates first/prev/next/last', async () => {
    const onNavigate = vi.fn();
    const { getAllByRole } = render(MoveStepper, { props: { currentPly: 3, total: 8, onNavigate } });
    const btns = getAllByRole('button');
    await fireEvent.click(btns[0]); expect(onNavigate).toHaveBeenCalledWith(0);       // first
    await fireEvent.click(btns[1]); expect(onNavigate).toHaveBeenCalledWith(2);       // prev
    await fireEvent.click(btns[2]); expect(onNavigate).toHaveBeenCalledWith(4);       // next
    await fireEvent.click(btns[3]); expect(onNavigate).toHaveBeenCalledWith(8);       // last
  });

  it('shows no play button without onTogglePlay', () => {
    const { queryByTestId } = render(MoveStepper, { props: { currentPly: 0, total: 4, onNavigate: () => {} } });
    expect(queryByTestId('autoplay')).toBeNull();
  });

  it('shows play/pause when onTogglePlay is set and toggles the icon by `playing`', async () => {
    const onTogglePlay = vi.fn();
    const { getByTestId, rerender } = render(MoveStepper, {
      props: { currentPly: 0, total: 4, onNavigate: () => {}, onTogglePlay, playing: false },
    });
    const b = getByTestId('autoplay');
    expect(b.getAttribute('title')).toBe('Auto-play');
    await fireEvent.click(b);
    expect(onTogglePlay).toHaveBeenCalled();
    await rerender({ currentPly: 0, total: 4, onNavigate: () => {}, onTogglePlay, playing: true });
    expect(getByTestId('autoplay').getAttribute('title')).toBe('Pause');
  });
});
