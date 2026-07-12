import { it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ViewMenu from '../components/ViewMenu.svelte';

it('renders 4 switches and toggling "Engine Lines" calls onToggle("lines")', async () => {
  const onToggle = vi.fn();
  const prefs = { evalBar: true, lines: true, arrows: true, feedback: true };
  const { getAllByRole, getByRole } = render(ViewMenu, { props: { prefs, onToggle } });
  // 4 switches: Evaluation Bar, Engine Lines, Suggestion Arrows, Move Feedback
  expect(getAllByRole('switch')).toHaveLength(4);
  const linesSwitch = getByRole('switch', { name: 'Engine Lines' });
  await fireEvent.click(linesSwitch);
  expect(onToggle).toHaveBeenCalledWith('lines');
});
