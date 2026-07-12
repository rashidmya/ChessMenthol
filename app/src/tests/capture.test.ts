// app/src/tests/capture.test.ts
import { describe, it, expect, vi } from 'vitest';
import { decodeCaptureBuffer, cropImage, type RgbaImage } from '../lib/image';

function header(w: number, h: number, rgba: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(8 + rgba.length);
  const v = new DataView(buf);
  v.setUint32(0, w, true);
  v.setUint32(4, h, true);
  new Uint8Array(buf, 8).set(rgba);
  return buf;
}

describe('decodeCaptureBuffer', () => {
  it('reads width/height header and views the RGBA tail', () => {
    const img = decodeCaptureBuffer(header(2, 1, [10, 20, 30, 255, 40, 50, 60, 255]));
    expect(img.width).toBe(2);
    expect(img.height).toBe(1);
    expect(Array.from(img.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });
});

describe('cropImage', () => {
  it('extracts a sub-rectangle in RGBA', () => {
    // 3x2 image; rows: [A B C] / [D E F], each pixel 4 bytes value v -> [v,v,v,255]
    const px = (v: number) => [v, v, v, 255];
    const data = new Uint8ClampedArray([...px(1), ...px(2), ...px(3), ...px(4), ...px(5), ...px(6)]);
    const src: RgbaImage = { data, width: 3, height: 2 };
    const crop = cropImage(src, { left: 1, top: 0, width: 2, height: 2 });
    expect(crop.width).toBe(2);
    expect(crop.height).toBe(2);
    // pixels B,C (row0) then E,F (row1)
    expect(Array.from(crop.data)).toEqual([...px(2), ...px(3), ...px(5), ...px(6)]);
  });
  it('clamps a region that runs past the image edge', () => {
    const data = new Uint8ClampedArray(2 * 2 * 4).fill(9);
    const crop = cropImage({ data, width: 2, height: 2 }, { left: 1, top: 1, width: 5, height: 5 });
    expect(crop.width).toBe(1);
    expect(crop.height).toBe(1);
  });
});
