import { describe, it, expect } from 'vitest';
import { detect } from '../vision/detect';
import { readOrientationFromLabels } from '../vision/coords';
import { renderBoard } from './visionFixtures';

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
