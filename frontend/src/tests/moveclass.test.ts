import { describe, it, expect } from 'vitest';
import { moveClass } from '../lib/moveclass';

describe('moveClass', () => {
  it('maps labels to list CSS classes', () => {
    expect(moveClass({ label: 'blunder', cpl: 0, isBest: false })).toBe('blun');
    expect(moveClass({ label: 'mistake', cpl: 0, isBest: false })).toBe('mist');
    expect(moveClass({ label: 'good', cpl: 0, isBest: false })).toBe('good');
    expect(moveClass({ label: 'best', cpl: 0, isBest: true })).toBe('best');
    expect(moveClass({ label: 'book', cpl: 0, isBest: false })).toBe('');
    expect(moveClass(null)).toBe('');
  });

  it('covers the remaining label aliases and unknowns', () => {
    expect(moveClass({ label: 'excellent', cpl: 0, isBest: false })).toBe('good');
    expect(moveClass({ label: 'great', cpl: 0, isBest: false })).toBe('best');
    expect(moveClass({ label: 'miss', cpl: 0, isBest: false })).toBe('mist');
    expect(moveClass({ label: 'inaccuracy', cpl: 0, isBest: false })).toBe('inacc');
    expect(moveClass({ label: 'brilliant', cpl: 0, isBest: false })).toBe('brill');
    expect(moveClass({ label: 'nonsense', cpl: 0, isBest: false })).toBe('');
  });
});
