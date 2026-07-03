// app/src/tests/detect.test.ts
import { describe, it, expect } from 'vitest';
import { detect, cropSquares } from '../vision/detect';
import { renderBoard, iou, loadFixturePng } from './visionFixtures';
import groundTruth from './fixtures/vision/ground_truth.json';

describe('detect — synthetic golden boards', () => {
  it('clean board: bbox IoU > 0.95, 9x9 grid, square ~40, confidence > 0.6', () => {
    const { image, truth } = renderBoard({ square: 40, margin: 24 });
    const loc = detect(image);
    expect(loc).not.toBeNull();
    expect(iou(loc!.bbox, truth.bbox)).toBeGreaterThan(0.95);
    expect(loc!.gridX).toHaveLength(9);
    expect(loc!.gridY).toHaveLength(9);
    expect(Math.abs(loc!.squareSize - 40)).toBeLessThanOrEqual(2);
    expect(loc!.confidence).toBeGreaterThan(0.6);
  });

  it('no-margin board: IoU > 0.90', () => {
    const { image, truth } = renderBoard({ square: 40, margin: 0 });
    const loc = detect(image);
    expect(loc).not.toBeNull();
    expect(iou(loc!.bbox, truth.bbox)).toBeGreaterThan(0.90);
  });

  it('rejects pure noise (returns null)', () => {
    // deterministic LCG noise (no Math.random in tests-as-fixtures)
    let s = 1; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const n = 300; const data = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : Math.floor(rnd() * 256);
    expect(detect({ data, width: n, height: n })).toBeNull();
  });

  it('detects orientation hint white_bottom', () => {
    const { image } = renderBoard({ square: 40, margin: 24 });
    expect(detect(image)!.orientationHint).toBe('white_bottom');
  });

  it('finds highlight squares e2,e4 and none on a clean board', () => {
    const hl = detect(renderBoard({ square: 40, margin: 24, highlights: ['e2', 'e4'] }).image)!;
    expect(new Set(hl.highlightSquares)).toEqual(new Set(['e2', 'e4']));
    expect(detect(renderBoard({ square: 40, margin: 24 }).image)!.highlightSquares).toEqual([]);
  });

  it('detects the highlight under a piece on the destination square', () => {
    // e4 is highlighted AND occupied (a real last-move destination). Centre sampling
    // is dominated by the piece; corner sampling still sees the overlay.
    const loc = detect(renderBoard({
      square: 40, margin: 24, highlights: ['e2', 'e4'], pieces: ['e4'],
    }).image)!;
    expect(new Set(loc.highlightSquares)).toEqual(new Set(['e2', 'e4']));
  });

  it('ignores a red check/premove pair (warm-tint gate)', () => {
    const loc = detect(renderBoard({
      square: 40, margin: 24, premove: ['e7', 'e8'],
    }).image)!;
    expect(loc.highlightSquares).toEqual([]);
  });

  it('prefers the yellow last-move pair over a red premove pair', () => {
    const loc = detect(renderBoard({
      square: 40, margin: 24, highlights: ['e2', 'e4'], premove: ['a7', 'a8'],
    }).image)!;
    expect(new Set(loc.highlightSquares)).toEqual(new Set(['e2', 'e4']));
  });

  it('detects a warm pair straddling a light and a dark square', () => {
    // e2 is a light-parity square, e3 a dark one; the warm gate must fire on BOTH
    // (the translucent overlay adds the same hue over either base colour).
    const loc = detect(renderBoard({
      square: 40, margin: 24, highlights: ['e2', 'e3'],
    }).image)!;
    expect(new Set(loc.highlightSquares)).toEqual(new Set(['e2', 'e3']));
  });

  it('robustness: IoU > 0.95 across geometry + theme variants', () => {
    for (const [square, margin] of [[24, 8], [32, 16], [40, 24], [56, 4], [64, 40]] as const) {
      const { image, truth } = renderBoard({ square, margin });
      const loc = detect(image);
      expect(loc, `square=${square} margin=${margin}`).not.toBeNull();
      expect(iou(loc!.bbox, truth.bbox)).toBeGreaterThan(0.95);
    }
  });
});

describe('cropSquares', () => {
  it('returns 64 crops in canonical a1..h8 order', () => {
    const { image } = renderBoard({ square: 40, margin: 24 });
    const loc = detect(image);
    expect(loc).not.toBeNull();
    const crops = cropSquares(image, loc!);
    expect(crops).toHaveLength(64);
    expect(crops[0].square).toBe('a1');
    expect(crops[7].square).toBe('h1');
    expect(crops[63].square).toBe('h8');
  });
});

describe('detect — committed real boards', () => {
  it.each(Object.keys(groundTruth as Record<string, unknown>))('IoU > 0.9 on %s', (name) => {
    const gt = (groundTruth as Record<string, { left: number; top: number; width: number; height: number }>)[name];
    const loc = detect(loadFixturePng(name));
    expect(loc).not.toBeNull();
    expect(iou(loc!.bbox, gt)).toBeGreaterThan(0.9);
  });
});
