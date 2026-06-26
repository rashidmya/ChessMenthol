import { describe, it, expect } from 'vitest';
import { buildFen, kingCountOk, pieceFromToken, coordsToKey } from '../lib/edit';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

describe('buildFen', () => {
  it('builds a full FEN from the start placement, white to move', () => {
    expect(buildFen(START, 'white')).toBe(`${START} w KQkq - 0 1`);
  });
  it('uses b for black to move', () => {
    expect(buildFen(START, 'black')).toBe(`${START} b KQkq - 0 1`);
  });
  it('drops castling when the king has moved off its home square', () => {
    const p = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPKPPP/RNBQ1BNR';
    expect(buildFen(p, 'white')).toBe(`${p} w kq - 0 1`);
  });
  it('keeps only kingside for white when the a1 rook is missing', () => {
    const p = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR';
    expect(buildFen(p, 'white')).toBe(`${p} w Kkq - 0 1`);
  });
  it('keeps only queenside for black when the h8 rook is missing', () => {
    // black h8 rook absent -> black keeps only q; white rights intact
    const p = 'rnbqkbn1/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
    expect(buildFen(p, 'white')).toBe(`${p} w KQq - 0 1`);
  });
  it('emits - for castling when no rights remain', () => {
    const p = '4k3/8/8/8/8/8/8/4K3';
    expect(buildFen(p, 'white')).toBe(`${p} w - - 0 1`);
  });
});

describe('kingCountOk', () => {
  it('accepts exactly one king per side', () => {
    expect(kingCountOk(START)).toBe(true);
  });
  it('rejects a missing king', () => {
    expect(kingCountOk('rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(false);
  });
  it('rejects a missing white king', () => {
    expect(kingCountOk('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1BNR')).toBe(false);
  });
  it('rejects two white kings', () => {
    expect(kingCountOk('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBKR')).toBe(false);
  });
  it('rejects two black kings', () => {
    expect(kingCountOk('rnbqkbkr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(false);
  });
});

describe('pieceFromToken', () => {
  it('maps an uppercase token to a white piece', () => {
    expect(pieceFromToken('N')).toEqual({ role: 'knight', color: 'white' });
  });
  it('maps a lowercase token to a black piece', () => {
    expect(pieceFromToken('p')).toEqual({ role: 'pawn', color: 'black' });
  });
  it('throws on an unknown token', () => {
    expect(() => pieceFromToken('x')).toThrow();
  });
});

describe('coordsToKey', () => {
  it('maps board corners for white orientation', () => {
    expect(coordsToKey(0, 0, 400, 400, 'white')).toBe('a8');
    expect(coordsToKey(0, 399, 400, 400, 'white')).toBe('a1');
    expect(coordsToKey(399, 0, 400, 400, 'white')).toBe('h8');
    expect(coordsToKey(399, 399, 400, 400, 'white')).toBe('h1');
  });
  it('flips for black orientation', () => {
    expect(coordsToKey(0, 0, 400, 400, 'black')).toBe('h1');
  });
});
