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
});
