import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const { isTauriMock, minimizeMock, toggleMaximizeMock, closeMock, isMaximizedMock, onResizedMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => true),
  minimizeMock: vi.fn(async (..._a: unknown[]) => {}),
  toggleMaximizeMock: vi.fn(async (..._a: unknown[]) => {}),
  closeMock: vi.fn(async (..._a: unknown[]) => {}),
  isMaximizedMock: vi.fn(async (..._a: unknown[]) => false),
  onResizedMock: vi.fn(async (..._a: unknown[]) => () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => isTauriMock() }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: (...a: unknown[]) => minimizeMock(...a),
    toggleMaximize: (...a: unknown[]) => toggleMaximizeMock(...a),
    close: (...a: unknown[]) => closeMock(...a),
    isMaximized: (...a: unknown[]) => isMaximizedMock(...a),
    onResized: (...a: unknown[]) => onResizedMock(...a),
  }),
}));

import Titlebar from '../components/Titlebar.svelte';

beforeEach(() => {
  isTauriMock.mockReturnValue(true);
  minimizeMock.mockReset();
  minimizeMock.mockResolvedValue(undefined);
  toggleMaximizeMock.mockReset();
  toggleMaximizeMock.mockResolvedValue(undefined);
  closeMock.mockReset();
  closeMock.mockResolvedValue(undefined);
  isMaximizedMock.mockReset();
  isMaximizedMock.mockResolvedValue(false);
  onResizedMock.mockReset();
  onResizedMock.mockResolvedValue(() => {});
});

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

  it('clicking minimize calls the window minimize method', async () => {
    const { getByTestId } = render(Titlebar);
    await fireEvent.click(getByTestId('tb-minimize'));
    await waitFor(() => expect(minimizeMock).toHaveBeenCalledTimes(1));
  });

  it('clicking maximize calls the window toggleMaximize method', async () => {
    const { getByTestId } = render(Titlebar);
    await fireEvent.click(getByTestId('tb-maximize'));
    await waitFor(() => expect(toggleMaximizeMock).toHaveBeenCalledTimes(1));
  });

  it('clicking close calls the window close method', async () => {
    const { getByTestId } = render(Titlebar);
    await fireEvent.click(getByTestId('tb-close'));
    await waitFor(() => expect(closeMock).toHaveBeenCalledTimes(1));
  });

  it('shows the Restore affordance once the window reports maximized on mount', async () => {
    isMaximizedMock.mockResolvedValueOnce(true);
    const { getByTestId } = render(Titlebar);
    await waitFor(() => {
      const btn = getByTestId('tb-maximize');
      expect(btn.getAttribute('aria-label')).toBe('Restore');
      expect(btn.getAttribute('title')).toBe('Restore');
    });
  });
});
