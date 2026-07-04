import { describe, it, expect, vi, beforeEach } from 'vitest';

// isMobile() reads isTauri() (core) + platform() (plugin-os); mock both.
const { platformMock, isTauriMock } = vi.hoisted(() => ({
  platformMock: vi.fn(() => 'android'),
  isTauriMock: vi.fn(() => true),
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => platformMock() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => isTauriMock() }));

import { isMobile } from '../lib/platform';

beforeEach(() => {
  platformMock.mockClear();
  isTauriMock.mockClear();
});

describe('isMobile', () => {
  it('is true on android under Tauri', () => {
    isTauriMock.mockReturnValue(true);
    platformMock.mockReturnValue('android');
    expect(isMobile()).toBe(true);
  });

  it('is true on ios under Tauri', () => {
    isTauriMock.mockReturnValue(true);
    platformMock.mockReturnValue('ios');
    expect(isMobile()).toBe(true);
  });

  it('is false on desktop (linux) under Tauri', () => {
    isTauriMock.mockReturnValue(true);
    platformMock.mockReturnValue('linux');
    expect(isMobile()).toBe(false);
  });

  it('is false in a plain browser and never calls platform()', () => {
    isTauriMock.mockReturnValue(false);
    expect(isMobile()).toBe(false);
    expect(platformMock).not.toHaveBeenCalled();
  });

  it('is false (not throwing) when the OS plugin is unavailable', () => {
    isTauriMock.mockReturnValue(true);
    platformMock.mockImplementation(() => { throw new Error('os plugin not registered'); });
    expect(isMobile()).toBe(false);
  });
});
