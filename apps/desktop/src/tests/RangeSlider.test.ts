import { it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import RangeSlider from '../components/RangeSlider.svelte';

it('shows the label for the current index and emits on input', async () => {
  const onInput = vi.fn();
  const { getByRole, getByTestId } = render(RangeSlider, {
    props: { min: 0, max: 5, value: 2, labels: ['2s','5s','10s','20s','30s','∞'], onInput },
  });
  expect(getByTestId('range-value').textContent).toBe('10s');
  const input = getByRole('slider') as HTMLInputElement;
  input.value = '5';
  await fireEvent.input(input);
  expect(onInput).toHaveBeenCalledWith(5);
});
