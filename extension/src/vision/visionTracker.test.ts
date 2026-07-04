import { describe, it, expect, vi } from 'vitest';
import { TabTracker } from './visionTracker';
import type { RgbaImage } from '@core/lib/capture';

const img = (): RgbaImage => ({ data: new Uint8ClampedArray(4).fill(9), width: 1, height: 1 });

describe('TabTracker (VisionTrackerLike)', () => {
  it('detectPosition grabs then forwards to the worker client', async () => {
    const grab = vi.fn(async () => img());
    const client = { detectPosition: vi.fn(async () => ({ fen: 'F', isLegal: true } as never)), setSideOverride: vi.fn(), setOrientationOverride: vi.fn(), reset: vi.fn() };
    const capturer = { grab, grabFullDesktop: vi.fn(async () => img()), setRegion: vi.fn() };
    const t = new TabTracker(capturer as never, client as never);
    const res = await t.detectPosition();
    expect(grab).toHaveBeenCalledOnce();
    expect(client.detectPosition).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ fen: 'F' });
  });

  it('forwards overrides + reset + region to the right collaborators', () => {
    const client = { detectPosition: vi.fn(), setSideOverride: vi.fn(), setOrientationOverride: vi.fn(), reset: vi.fn() };
    const capturer = { grab: vi.fn(), grabFullDesktop: vi.fn(), setRegion: vi.fn() };
    const t = new TabTracker(capturer as never, client as never);
    t.setSideOverride(true); t.setOrientationOverride('black_bottom'); t.reset(); t.setRegion(null);
    expect(client.setSideOverride).toHaveBeenCalledWith(true);
    expect(client.setOrientationOverride).toHaveBeenCalledWith('black_bottom');
    expect(client.reset).toHaveBeenCalledOnce();
    expect(capturer.setRegion).toHaveBeenCalledWith(null);
  });
});
