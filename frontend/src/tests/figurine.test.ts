import { describe, it, expect } from 'vitest';
import { toFigurine } from '../lib/figurine';

describe('toFigurine', () => {
  it('maps piece letters to filled glyphs', () => {
    expect(toFigurine('Nf3')).toBe('♞f3');
    expect(toFigurine('Bxc3')).toBe('♝xc3');
    expect(toFigurine('Qxd8+')).toBe('♛xd8+');
    expect(toFigurine('Rae1')).toBe('♜ae1');
    expect(toFigurine('Kf1')).toBe('♚f1');
  });

  it('leaves pawn moves without a glyph', () => {
    expect(toFigurine('bxc3')).toBe('bxc3'); // lowercase b = file, not bishop
    expect(toFigurine('e4')).toBe('e4');
    expect(toFigurine('exd5')).toBe('exd5');
  });

  it('leaves castling unchanged and converts promotion suffix', () => {
    expect(toFigurine('O-O')).toBe('O-O');
    expect(toFigurine('O-O-O')).toBe('O-O-O');
    expect(toFigurine('a8=Q')).toBe('a8=♛');
  });

  it('converts a full numbered variation string', () => {
    expect(toFigurine('16... O-O-O 17. Nd7 Bg3')).toBe('16... O-O-O 17. ♞d7 ♝g3');
    expect(toFigurine('1...e5 2. Nf3 Nc6 …')).toBe('1...e5 2. ♞f3 ♞c6 …');
  });

  it('returns empty string unchanged', () => {
    expect(toFigurine('')).toBe('');
  });
});
