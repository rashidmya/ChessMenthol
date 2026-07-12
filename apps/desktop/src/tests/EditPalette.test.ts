import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import EditPalette from '../components/EditPalette.svelte';

describe('EditPalette', () => {
  it('renders the palette and emits a piece token on click', async () => {
    const onSelect = vi.fn();
    render(EditPalette, { selected: 'P', onSelect });
    expect(screen.getByTestId('edit-palette')).toBeTruthy();
    await fireEvent.click(screen.getByTestId('pal-n'));
    expect(onSelect).toHaveBeenCalledWith('n');
  });

  it('emits trash for the eraser', async () => {
    const onSelect = vi.fn();
    render(EditPalette, { selected: 'P', onSelect });
    await fireEvent.click(screen.getByTestId('pal-trash'));
    expect(onSelect).toHaveBeenCalledWith('trash');
  });
});
