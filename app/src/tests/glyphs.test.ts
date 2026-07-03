import { describe, it, expect } from 'vitest';
import { GLYPHS, glyphFor } from '../lib/glyphs';

// The 9 MoveClass taxonomy values — each must have a glyph spec.
const MOVE_CLASSES = [
  'brilliant', 'great', 'best', 'excellent', 'good',
  'inaccuracy', 'mistake', 'blunder', 'miss',
];

describe('glyphs', () => {
  it('has a spec for every MoveClass value', () => {
    for (const label of MOVE_CLASSES) {
      expect(GLYPHS[label], label).toBeDefined();
    }
  });

  it('every spec has a 6-digit hex color', () => {
    for (const label of MOVE_CLASSES) {
      expect(GLYPHS[label].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('text-kind specs carry their symbol', () => {
    expect(GLYPHS.blunder).toEqual({ kind: 'text', symbol: '??', color: '#f7402d' });
    expect(GLYPHS.best.kind).toBe('star');
  });

  it('glyphFor returns a neutral fallback for an unknown label', () => {
    const f = glyphFor('not-a-real-label');
    expect(f.color).toBe('#8a8a8a');
    expect(f.kind).toBe('text');
  });

  it('glyphFor returns the mapped spec for a known label', () => {
    expect(glyphFor('brilliant')).toBe(GLYPHS.brilliant);
  });
});
