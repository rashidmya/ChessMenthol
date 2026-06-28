// frontend/src/tests/visionTypes.test.ts
import { describe, it, expect } from 'vitest';
import { squareName } from '../vision/types';
import type { RgbaImage } from '../vision/types';
import { renderBoard, iou } from './visionFixtures';

// Center pixel RGB of cell (col,row); mirrors renderBoard's index math.
function cellCenterRgb(
  image: RgbaImage,
  col: number,
  row: number,
  square: number,
  margin: number,
): [number, number, number] {
  const x = margin + col * square + Math.trunc(square / 2);
  const y = margin + row * square + Math.trunc(square / 2);
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

describe('squareName', () => {
  it('white_bottom maps geometric origin to a8 and h1', () => {
    expect(squareName(0, 0, 'white_bottom')).toBe('a8');
    expect(squareName(7, 7, 'white_bottom')).toBe('h1');
  });
  it('white_bottom maps a middle square (4,3) to e5', () => {
    expect(squareName(4, 3, 'white_bottom')).toBe('e5');
  });
  it('black_bottom flips files and ranks', () => {
    expect(squareName(0, 0, 'black_bottom')).toBe('h1');
    expect(squareName(7, 7, 'black_bottom')).toBe('a8');
  });
  it('null orientation defaults to white_bottom', () => {
    expect(squareName(0, 0, null)).toBe('a8');
    expect(squareName(7, 7, null)).toBe('h1');
  });
});

describe('iou', () => {
  it('perfect overlap of identical rects -> 1.0', () => {
    const r = { left: 5, top: 7, width: 30, height: 40 };
    expect(iou(r, { ...r })).toBe(1.0);
  });
  it('fully disjoint rects -> 0.0', () => {
    const a = { left: 0, top: 0, width: 10, height: 10 };
    const b = { left: 100, top: 100, width: 10, height: 10 };
    expect(iou(a, b)).toBe(0.0);
  });
});

describe('renderBoard', () => {
  it('produces a deterministic axis-aligned board with ground-truth grid', () => {
    const { image, truth } = renderBoard({ square: 32, margin: 16 });
    expect(image.width).toBe(16 * 2 + 32 * 8);
    expect(truth.gridX).toEqual([16, 48, 80, 112, 144, 176, 208, 240, 272]);
    expect(truth.squareSize).toBe(32);
    expect(truth.orientationHint).toBe('white_bottom');
  });

  it('cells alternate colors: light vs dark cell centers differ (canary)', () => {
    const square = 32, margin = 16;
    const { image } = renderBoard({ square, margin });
    const lightCenter = cellCenterRgb(image, 0, 0, square, margin);
    const darkCenter = cellCenterRgb(image, 1, 0, square, margin);
    expect(lightCenter).toEqual([240, 217, 181]);
    expect(darkCenter).toEqual([181, 136, 99]);
    expect(lightCenter).not.toEqual(darkCenter);
  });

  it('records highlight squares in the ground-truth location', () => {
    const { truth } = renderBoard({ square: 40, margin: 24, highlights: ['e2', 'e4'] });
    expect(new Set(truth.highlightSquares)).toEqual(new Set(['e2', 'e4']));
  });
});
