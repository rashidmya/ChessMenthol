import { describe, it, expect } from 'vitest';
import { turnColor, legalDests } from '../lib/board';

describe('turnColor', () => {
  it('reads white to move', () => {
    expect(turnColor('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe('white');
  });
  it('reads black to move', () => {
    expect(turnColor('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe('black');
  });
  it('defaults to white when the side field is missing', () => {
    expect(turnColor('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe('white');
  });
});

describe('legalDests', () => {
  it('maps the side-to-move squares to their legal destinations at the start', () => {
    const d = legalDests('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(d.get('e2')?.slice().sort()).toEqual(['e3', 'e4']);
    expect(d.get('g1')?.slice().sort()).toEqual(['f3', 'h3']);
    expect(d.size).toBe(10); // 8 pawns + 2 knights have moves; only the side to move
    expect(d.has('e7')).toBe(false); // black piece, not white's turn
  });
  it('maps the black side when black is to move', () => {
    const d = legalDests('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(d.get('e7')?.slice().sort()).toEqual(['e5', 'e6']);
    expect(d.has('e2')).toBe(false); // white piece, not black's turn
  });
  it('returns an empty map for an unparseable FEN (e.g. a transient edit position)', () => {
    expect(legalDests('not a fen').size).toBe(0);
  });
});
