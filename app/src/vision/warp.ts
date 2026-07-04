// app/src/vision/warp.ts
// Perspective-warp a 4-corner quad (in a source RGBA image) to a clean axis-aligned
// N×N square, so a hand-held photo of a board becomes the pixel-perfect input the
// detect→pieces pipeline expects. Pure TS (no OpenCV), inverse-mapped + bilinear.
import type { RgbaImage } from '../lib/capture';

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // TL, TR, BR, BL

/** 3×3 homography (row-major, 9 elems) mapping the 4 `from` points to `to`.
 *  Solves the 8×8 linear system for h11..h32 with h33 fixed to 1. */
export function computeHomography(from: Quad, to: Quad): number[] {
  // Build A·h = b where h = [h11 h12 h13 h21 h22 h23 h31 h32].
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
  }
  const h = solve8(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting for an 8×8 system. */
function solve8(A: number[][], b: number[]): number[] {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/** Warp the `quad` region of `src` into a `size`×`size` axis-aligned square.
 *  Inverse map: for each dest pixel, sample the source via the square→quad homography. */
export function warpQuadToSquare(src: RgbaImage, quad: Quad, size: number): RgbaImage {
  const square: Quad = [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }];
  const H = computeHomography(square, quad); // dest(square) -> source(quad)
  const out = new Uint8ClampedArray(size * size * 4);
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const w = H[6] * u + H[7] * v + H[8];
      const sx = (H[0] * u + H[1] * v + H[2]) / w;
      const sy = (H[3] * u + H[4] * v + H[5]) / w;
      sampleBilinear(src, sx, sy, out, (v * size + u) * 4);
    }
  }
  return { data: out, width: size, height: size };
}

/** Bilinear sample src at (x,y), writing RGBA into out[o..o+3]. Clamps to edges. */
function sampleBilinear(src: RgbaImage, x: number, y: number, out: Uint8ClampedArray, o: number): void {
  const { data, width, height } = src;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const cx0 = Math.max(0, Math.min(width - 1, x0)), cx1 = Math.max(0, Math.min(width - 1, x0 + 1));
  const cy0 = Math.max(0, Math.min(height - 1, y0)), cy1 = Math.max(0, Math.min(height - 1, y0 + 1));
  for (let c = 0; c < 4; c++) {
    const p00 = data[(cy0 * width + cx0) * 4 + c], p10 = data[(cy0 * width + cx1) * 4 + c];
    const p01 = data[(cy1 * width + cx0) * 4 + c], p11 = data[(cy1 * width + cx1) * 4 + c];
    const top = p00 + (p10 - p00) * fx, bot = p01 + (p11 - p01) * fx;
    out[o + c] = top + (bot - top) * fy;
  }
}
