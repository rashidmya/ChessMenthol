import { describe, it, expect } from 'vitest';
import { makePositionPgn, looksLikePgn } from '../core/pgn';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('makePositionPgn', () => {
  it('emits a plain seven-tag roster for the standard start (no SetUp/FEN)', () => {
    const pgn = makePositionPgn(START);
    expect(pgn).toContain('[Event ');
    expect(pgn).not.toContain('[FEN ');
    expect(pgn).not.toContain('[SetUp ');
  });

  it('emits SetUp + FEN tags for a non-standard position', () => {
    const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    const pgn = makePositionPgn(fen);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${fen}"]`);
  });
});

describe('looksLikePgn', () => {
  it('detects a tag header', () => {
    expect(looksLikePgn('[Event "x"]\n\n1. e4 e5 *')).toBe(true);
  });
  it('detects a move-number movetext with no headers', () => {
    expect(looksLikePgn('1. e4 e5 2. Nf3 Nc6 *')).toBe(true);
  });
  it('treats a bare FEN as not-PGN', () => {
    expect(looksLikePgn(START)).toBe(false);
  });
});
