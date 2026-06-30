import { it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import EngineHeader from '../components/EngineHeader.svelte';

const defaultProps = {
  analysisEnabled: true,
  analyzing: false,
  depth: 24,
  engineId: 'stockfish',
  onCommand: vi.fn(),
  onSetEngine: vi.fn(),
  prefs: { evalBar: true, lines: true, arrows: true, feedback: true },
  onToggle: vi.fn(),
};

it('toggling Analysis switch emits set_analysis_enabled with enabled:false when analysisEnabled=true', async () => {
  const onCommand = vi.fn();
  const { getByRole } = render(EngineHeader, { props: { ...defaultProps, onCommand } });
  const sw = getByRole('switch', { name: 'Analysis' });
  await fireEvent.click(sw);
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_analysis_enabled', enabled: false });
});

it('tag shows depth and engine name', () => {
  const { container } = render(EngineHeader, { props: defaultProps });
  expect(container.querySelector('.tag')?.textContent).toContain('depth 24');
  expect(container.querySelector('.eng')?.textContent).toBe('Stockfish 18');
});

it('hides the View options button when analysis is disabled (cog + Analysis switch stay)', () => {
  const { queryByRole, getByRole } = render(EngineHeader, {
    props: { ...defaultProps, analysisEnabled: false },
  });
  expect(queryByRole('button', { name: 'View options' })).toBeNull();
  expect(getByRole('button', { name: 'Engine settings' })).toBeTruthy();
  expect(getByRole('switch', { name: 'Analysis' })).toBeTruthy();
});

it('shows the View options button when analysis is enabled', () => {
  const { getByRole } = render(EngineHeader, { props: defaultProps });
  expect(getByRole('button', { name: 'View options' })).toBeTruthy();
});

it('cog click opens settings popover; menu click swaps to view menu; body click closes both', async () => {
  const { container, getByRole } = render(EngineHeader, { props: defaultProps });
  const cogBtn = getByRole('button', { name: 'Engine settings' });
  const menuBtn = getByRole('button', { name: 'View options' });

  // initially both closed
  expect(container.querySelector('.settings.open')).toBeNull();

  // click cog → settings popover opens
  await fireEvent.click(cogBtn);
  await tick();
  expect(container.querySelector('.settings:not(.menu).open')).not.toBeNull();

  // click menu → cog settings closes, view menu opens
  await fireEvent.click(menuBtn);
  await tick();
  expect(container.querySelector('.settings:not(.menu).open')).toBeNull();
  expect(container.querySelector('.settings.menu.open')).not.toBeNull();

  // click document.body → both close
  await fireEvent.click(document.body);
  await tick();
  expect(container.querySelector('.settings.open')).toBeNull();
});
