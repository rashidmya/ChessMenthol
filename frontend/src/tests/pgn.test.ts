import { describe, it, expect } from 'vitest';
import { makePositionPgn, looksLikePgn, parseGame } from '../core/pgn';

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

describe('parseGame', () => {
  it('parses mainline SAN into UCI from the standard start', () => {
    const g = parseGame('[Event "x"]\n\n1. e4 e5 2. Nf3 Nc6 *');
    expect(g.baseFen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    expect(g.moves.map((m) => m.uci)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('honours a [FEN]/[SetUp] starting position', () => {
    const pgn = '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. Rh8+ *';
    const g = parseGame(pgn);
    expect(g.baseFen.startsWith('4k3/8/8/8/8/8/8/4K2R w K')).toBe(true);
    expect(g.moves[0].uci).toBe('h1h8');
  });

  it('takes the first game of a multi-game file', () => {
    const g = parseGame('1. d4 d5 *\n\n1. c4 c5 *');
    expect(g.moves[0].uci).toBe('d2d4');
  });

  it('throws on illegal SAN', () => {
    expect(() => parseGame('1. e5 *')).toThrow();
  });

  it('emits king-two-square castling UCIs (Stockfish/UI parity), both colours', () => {
    const wk = parseGame('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. O-O *');
    expect(wk.moves[0].uci).toBe('e1g1');
    const wq = parseGame('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. O-O-O *');
    expect(wq.moves[0].uci).toBe('e1c1');
    const bk = parseGame('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1"]\n\n1... O-O *');
    expect(bk.moves[0].uci).toBe('e8g8');
    const bq = parseGame('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1"]\n\n1... O-O-O *');
    expect(bq.moves[0].uci).toBe('e8c8');
    // sanity: SAN still reads as O-O / O-O-O
    expect(wk.moves[0].san).toContain('O-O');
  });
});
