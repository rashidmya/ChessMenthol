import { describe, it, expect } from 'vitest';
import { detect } from '../vision/detect';
import { readOrientationFromLabels, decide } from '../vision/coords';
import { renderBoard } from './visionFixtures';

describe('decide — gate thresholds (MIN_INK=0.04, MIN_LABEL=0.015, RATIO=1.6)', () => {
  it('null when only one corner is inked (lo < MIN_LABEL)', () => {
    expect(decide(0.05, 0.005)).toBeNull();
  });
  it('null when both inked but too close (ratio 1.25 < RATIO)', () => {
    expect(decide(0.05, 0.04)).toBeNull();
  });
  it('null on a tie (ratio 1.0 < RATIO)', () => {
    expect(decide(0.05, 0.05)).toBeNull();
  });
  it('white_bottom when the top corner is denser (ratio 2.5 >= RATIO)', () => {
    expect(decide(0.05, 0.02)).toBe('white_bottom');
  });
  it('black_bottom when the bottom corner is denser', () => {
    expect(decide(0.02, 0.05)).toBe('black_bottom');
  });
});

describe('readOrientationFromLabels — inside-corner labels', () => {
  it('reads white_bottom (rank 8 label at top)', () => {
    const { image } = renderBoard({ square: 48, margin: 24, coords: 'white_bottom' });
    const loc = detect(image)!;
    expect(readOrientationFromLabels(image, loc)).toBe('white_bottom');
  });

  it('reads black_bottom (rank 8 label at bottom)', () => {
    const { image } = renderBoard({ square: 48, margin: 24, coords: 'black_bottom' });
    const loc = detect(image)!;
    expect(readOrientationFromLabels(image, loc)).toBe('black_bottom');
  });

  it('returns null when there are no coordinate labels', () => {
    const { image } = renderBoard({ square: 48, margin: 24 });
    const loc = detect(image)!;
    expect(readOrientationFromLabels(image, loc)).toBeNull();
  });
});

describe('readOrientationFromLabels — margin labels + gating', () => {
  it('falls back to left-margin labels (lichess) — white_bottom', () => {
    // margin (32) must be >= the reader's 0.6*square band (28) so the band is on-screen
    const { image } = renderBoard({ square: 48, margin: 32, marginCoords: 'white_bottom' });
    const loc = detect(image)!;
    expect(readOrientationFromLabels(image, loc)).toBe('white_bottom');
  });

  it('falls back to left-margin labels (lichess) — black_bottom', () => {
    const { image } = renderBoard({ square: 48, margin: 32, marginCoords: 'black_bottom' });
    const loc = detect(image)!;
    expect(readOrientationFromLabels(image, loc)).toBe('black_bottom');
  });

  it('returns null when only one corner is inked (a lone edge piece, no coords)', () => {
    const { image } = renderBoard({ square: 48, margin: 24, pieces: ['a8'] });
    const loc = detect(image)!;
    expect(readOrientationFromLabels(image, loc)).toBeNull();
  });
});
