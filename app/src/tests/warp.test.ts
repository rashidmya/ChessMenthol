import { describe, it, expect } from 'vitest';
import { computeHomography, warpQuadToSquare, type Point, type Quad } from '../vision/warp';
import type { RgbaImage } from '../lib/capture';

function solid(w: number, h: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i*4]=rgb[0]; data[i*4+1]=rgb[1]; data[i*4+2]=rgb[2]; data[i*4+3]=255; }
  return { data, width: w, height: h };
}
// A 2x2 colour-blocks image (TL red, TR green, BL blue, BR white).
function quad2x2(n: number): RgbaImage {
  const img = solid(n, n, [0, 0, 0]);
  const put = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * n + x) * 4; img.data[i]=c[0]; img.data[i+1]=c[1]; img.data[i+2]=c[2]; img.data[i+3]=255;
    }
  };
  const h = n / 2;
  put(0,0,h,h,[255,0,0]); put(h,0,n,h,[0,255,0]); put(0,h,h,n,[0,0,255]); put(h,h,n,n,[255,255,255]);
  return img;
}
const px = (img: RgbaImage, x: number, y: number): number[] =>
  [img.data[(y*img.width+x)*4], img.data[(y*img.width+x)*4+1], img.data[(y*img.width+x)*4+2]];

describe('computeHomography', () => {
  it('maps the four source points onto the four destination points', () => {
    const from: Quad = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
    const to: Quad   = [{x:2,y:3},{x:22,y:1},{x:24,y:21},{x:1,y:19}];
    const H = computeHomography(from, to);
    for (let i = 0; i < 4; i++) {
      const p: Point = from[i];
      const w = H[6]*p.x + H[7]*p.y + H[8];
      const x = (H[0]*p.x + H[1]*p.y + H[2]) / w;
      const y = (H[3]*p.x + H[4]*p.y + H[5]) / w;
      expect(x).toBeCloseTo(to[i].x, 4);
      expect(y).toBeCloseTo(to[i].y, 4);
    }
  });
});

describe('warpQuadToSquare', () => {
  it('identity: a square quad over the whole image warps to (near) itself', () => {
    const src = quad2x2(16);
    const out = warpQuadToSquare(src, [{x:0,y:0},{x:16,y:0},{x:16,y:16},{x:0,y:16}], 16);
    expect(out.width).toBe(16); expect(out.height).toBe(16);
    expect(px(out, 2, 2)).toEqual([255,0,0]);       // TL red
    expect(px(out, 13, 2)).toEqual([0,255,0]);      // TR green
    expect(px(out, 2, 13)).toEqual([0,0,255]);      // BL blue
    expect(px(out, 13, 13)).toEqual([255,255,255]); // BR white
  });

  it('straightens a rotated/skewed quad into an axis-aligned square', () => {
    const blocks = quad2x2(40);
    const quad: Quad = [{x:5,y:2},{x:38,y:6},{x:34,y:37},{x:2,y:33}];
    const out = warpQuadToSquare(blocks, quad, 20);
    expect(px(out, 3, 3)[0]).toBeGreaterThan(200);   // TL red-ish (R high)
    expect(px(out, 16, 3)[1]).toBeGreaterThan(200);  // TR green-ish (G high)
    expect(px(out, 3, 16)[2]).toBeGreaterThan(200);  // BL blue-ish (B high)
    expect(px(out, 16, 16).every((c) => c > 200)).toBe(true); // BR white
  });
});
