import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { TabTracker } from './visionTracker';
import type { RgbaImage } from '@chessmenthol/core/lib/image';

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

  it('exposes busy while a capture is in flight and coalesces concurrent calls', async () => {
    let release!: (v: RgbaImage) => void;
    const grab = vi.fn(() => new Promise<RgbaImage>((r) => { release = r; }));
    const client = { detectPosition: vi.fn(async () => ({ fen: 'F', isLegal: true } as never)), setSideOverride: vi.fn(), setOrientationOverride: vi.fn(), reset: vi.fn() };
    const capturer = { grab, grabFullDesktop: vi.fn(async () => img()), setRegion: vi.fn() };
    const t = new TabTracker(capturer as never, client as never);
    expect(get(t.busy)).toBe(false);
    const p1 = t.detectPosition();
    const p2 = t.detectPosition();            // while the first is still capturing
    expect(get(t.busy)).toBe(true);
    expect(grab).toHaveBeenCalledTimes(1);    // no second screenshot
    release(img());
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(get(t.busy)).toBe(false);
    expect(client.detectPosition).toHaveBeenCalledTimes(1);
  });

  it('clears busy and starts fresh after a failed capture', async () => {
    const grab = vi.fn(async () => { throw new Error('boom'); });
    const client = { detectPosition: vi.fn(), setSideOverride: vi.fn(), setOrientationOverride: vi.fn(), reset: vi.fn() };
    const t = new TabTracker({ grab, grabFullDesktop: vi.fn(), setRegion: vi.fn() } as never, client as never);
    await expect(t.detectPosition()).rejects.toThrow('boom');
    expect(get(t.busy)).toBe(false);
    await expect(t.detectPosition()).rejects.toThrow('boom'); // a new attempt, not the cached rejection
    expect(grab).toHaveBeenCalledTimes(2);
  });

  it('stays busy through detection (not just the grab) and clears on a detect failure', async () => {
    const grab = vi.fn(async () => img());
    let reject!: (err: unknown) => void;
    const client = { detectPosition: vi.fn(() => new Promise((_res, rej) => { reject = rej; })), setSideOverride: vi.fn(), setOrientationOverride: vi.fn(), reset: vi.fn() };
    const capturer = { grab, grabFullDesktop: vi.fn(async () => img()), setRegion: vi.fn() };
    const t = new TabTracker(capturer as never, client as never);
    const p1 = t.detectPosition();
    const p2 = t.detectPosition();
    await Promise.resolve();
    await Promise.resolve();
    expect(get(t.busy)).toBe(true);
    expect(grab).toHaveBeenCalledTimes(1);
    expect(client.detectPosition).toHaveBeenCalledTimes(1);
    reject(new Error('detect failed'));
    await expect(p1).rejects.toThrow('detect failed');
    await expect(p2).rejects.toThrow('detect failed');
    expect(get(t.busy)).toBe(false);
    client.detectPosition.mockImplementation(async () => ({ fen: 'G', isLegal: true } as never));
    await t.detectPosition();
    expect(grab).toHaveBeenCalledTimes(2); // not coalesced forever
  });
});
