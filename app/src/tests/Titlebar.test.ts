import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Titlebar from '../components/Titlebar.svelte';

describe('Titlebar', () => {
  it('renders minimize, maximize and close controls with accessible labels', () => {
    const { getByTestId } = render(Titlebar);
    expect(getByTestId('tb-minimize').getAttribute('aria-label')).toBe('Minimize');
    // default (window not maximized) shows the Maximize affordance
    expect(getByTestId('tb-maximize').getAttribute('aria-label')).toBe('Maximize');
    const close = getByTestId('tb-close');
    expect(close.getAttribute('aria-label')).toBe('Close');
    expect(close.classList.contains('close')).toBe(true);
  });

  it('exposes a Tauri drag region for moving the window', () => {
    const { container } = render(Titlebar);
    expect(container.querySelector('[data-tauri-drag-region]')).not.toBeNull();
  });
});
