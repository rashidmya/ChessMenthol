import { describe, it, expect } from 'vitest';
import { moveColor } from '../lib/moveclass';
import { glyphFor } from '../lib/glyphs';

describe('moveColor', () => {
  it('colors only notable moves, using the shared glyph palette', () => {
    // Bad moves and the two exceptional good ones are the only labels the move
    // list highlights (per product spec); colors come from glyphs.ts.
    for (const label of ['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']) {
      expect(moveColor({ label, cpl: 0, isBest: false })).toBe(glyphFor(label).color);
    }
  });

  it('leaves ordinary moves and unknowns neutral (null = no color)', () => {
    for (const label of ['best', 'good', 'excellent']) {
      expect(moveColor({ label, cpl: 0, isBest: false })).toBeNull();
    }
    expect(moveColor({ label: 'nonsense', cpl: 0, isBest: false })).toBeNull();
    expect(moveColor(null)).toBeNull();
  });
});
