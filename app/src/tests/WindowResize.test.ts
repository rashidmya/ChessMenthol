import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const { isTauriMock, startResizeDraggingMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => true),
  startResizeDraggingMock: vi.fn(async (..._a: unknown[]) => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => isTauriMock() }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startResizeDragging: (...a: unknown[]) => startResizeDraggingMock(...a),
  }),
}));

import WindowResize from '../components/WindowResize.svelte';

beforeEach(() => {
  isTauriMock.mockReturnValue(true);
  startResizeDraggingMock.mockReset();
  startResizeDraggingMock.mockResolvedValue(undefined);
});

describe('WindowResize', () => {
  it('renders eight edge/corner grips', () => {
    const { container } = render(WindowResize);
    expect(container.querySelectorAll('.grip').length).toBe(8);
  });

  it('starts a native resize drag in the grip direction on mousedown', async () => {
    const { getByTestId } = render(WindowResize);
    await fireEvent.mouseDown(getByTestId('resize-se'), { button: 0 });
    await waitFor(() => expect(startResizeDraggingMock).toHaveBeenCalledWith('SouthEast'));
  });

  it('ignores non-primary mouse buttons', async () => {
    const { getByTestId } = render(WindowResize);
    await fireEvent.mouseDown(getByTestId('resize-e'), { button: 2 });
    expect(startResizeDraggingMock).not.toHaveBeenCalled();
  });
});
