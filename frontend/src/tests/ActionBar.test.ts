import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ActionBar from '../components/ActionBar.svelte';
describe('ActionBar', () => {
  it('navigates first/prev/next/last relative to currentPly/total', async () => {
    const onNavigate = vi.fn();
    const { getByTitle } = render(ActionBar, { props: { currentPly: 3, total: 5, onNavigate } });
    await fireEvent.click(getByTitle('First move')); expect(onNavigate).toHaveBeenCalledWith(0);
    await fireEvent.click(getByTitle('Previous move')); expect(onNavigate).toHaveBeenCalledWith(2);
    await fireEvent.click(getByTitle('Next move')); expect(onNavigate).toHaveBeenCalledWith(4);
    await fireEvent.click(getByTitle('Last move')); expect(onNavigate).toHaveBeenCalledWith(5);
  });
});
