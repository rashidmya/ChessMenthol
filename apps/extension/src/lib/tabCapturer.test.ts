import { describe, it, expect, vi } from 'vitest';
import { TabCapturer } from './tabCapturer';
import type { RgbaImage } from '@chessmenthol/core/lib/image';

function solid(w: number, h: number): RgbaImage {
  return { data: new Uint8ClampedArray(w * h * 4).fill(1), width: w, height: h };
}

describe('TabCapturer', () => {
  it('grabFullDesktop decodes the requested capture', async () => {
    const requestCapture = vi.fn(async () => 'data:image/png;base64,AAAA');
    const decode = vi.fn(async () => solid(4, 4));
    const cap = new TabCapturer(requestCapture, decode);
    const img = await cap.grabFullDesktop();
    expect(requestCapture).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledWith('data:image/png;base64,AAAA');
    expect(img.width).toBe(4);
  });

  it('grab() crops to the active region and hands out a fresh buffer', async () => {
    const cap = new TabCapturer(async () => 'x', async () => solid(8, 8));
    cap.setRegion({ left: 2, top: 2, width: 4, height: 4 });
    const img = await cap.grab();
    expect(img.width).toBe(4);
    expect(img.height).toBe(4);
    expect(img.data.length).toBe(4 * 4 * 4); // fresh, cropped buffer
  });

  it('throws a clear error when capture returns null', async () => {
    const cap = new TabCapturer(async () => null, async () => solid(1, 1));
    await expect(cap.grabFullDesktop()).rejects.toThrow(/capture/i);
  });

  it('retries once after Chrome\'s captures-per-second quota error', async () => {
    let calls = 0;
    const requestCapture = vi.fn(async () => {
      if (++calls === 1) throw new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.');
      return 'data:ok';
    });
    const decode = vi.fn(async () => solid(1, 1));
    const sleep = vi.fn(async () => {});
    const cap = new TabCapturer(requestCapture, decode, sleep);
    const img = await cap.grabFullDesktop();
    expect(img.width).toBe(1);
    expect(requestCapture).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(decode).toHaveBeenCalledWith('data:ok');
  });

  it('propagates a second quota failure instead of looping', async () => {
    const requestCapture = vi.fn(async () => {
      throw new Error('Error: This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.');
    });
    const cap = new TabCapturer(requestCapture, async () => solid(1, 1), async () => {});
    await expect(cap.grabFullDesktop()).rejects.toThrow(/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/);
    expect(requestCapture).toHaveBeenCalledTimes(2);
  });

  it('does not retry other capture errors', async () => {
    const requestCapture = vi.fn(async () => { throw new Error('Cannot access contents of the page'); });
    const cap = new TabCapturer(requestCapture, async () => solid(1, 1), async () => {});
    await expect(cap.grabFullDesktop()).rejects.toThrow(/Cannot access/);
    expect(requestCapture).toHaveBeenCalledTimes(1);
  });
});
