import { it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Switch from '../components/Switch.svelte';

it('reflects on state and emits toggle', async () => {
  const onToggle = vi.fn();
  const { getByRole } = render(Switch, { props: { on: true, onToggle, label: 'X' } });
  const sw = getByRole('switch');
  expect(sw.getAttribute('aria-checked')).toBe('true');
  await fireEvent.click(sw);
  expect(onToggle).toHaveBeenCalled();
});
