// frontend/src/tests/coreChess.test.ts
//
// TDD tests for core/chess.ts — the thin chessops wrapper layer.
// Written before the implementation (red → green workflow).

import { describe, it, expect } from 'vitest';
import {
  posFromFen,
  fenOf,
  legalDestsCg,
  legalMovesUci,
  playUci,
  sanOf,
  variationSan,
  outcomeOf,
  attackedBy,
} from '../core/chess';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MIDGAME_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

// Fool's mate: after 1.f3 e5 2.g4 Qh4#  — white king is mated, black wins
const FOOLS_MATE_FEN = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

// Stalemate: black king at a8, white queen c7, white king b6 — black to move, stalemated
const STALEMATE_FEN = 'k7/2Q5/1K6/8/8/8/8/8 b - - 0 1';

// ─── posFromFen / fenOf ───────────────────────────────────────────────────────

describe('posFromFen', () => {
  it('parses the starting position without throwing', () => {
    expect(() => posFromFen(START_FEN)).not.toThrow();
  });

  it('throws on an invalid FEN string', () => {
    expect(() => posFromFen('not a fen')).toThrow();
  });

  it('throws on an empty string', () => {
    expect(() => posFromFen('')).toThrow();
  });
});

describe('fenOf', () => {
  it('round-trips the start FEN', () => {
    expect(fenOf(posFromFen(START_FEN))).toBe(START_FEN);
  });

  it('round-trips a midgame FEN', () => {
    expect(fenOf(posFromFen(MIDGAME_FEN))).toBe(MIDGAME_FEN);
  });
});

// ─── legalMovesUci ───────────────────────────────────────────────────────────

describe('legalMovesUci', () => {
  it('returns exactly 20 legal moves from the start position', () => {
    const moves = legalMovesUci(posFromFen(START_FEN));
    expect(moves).toHaveLength(20);
  });

  it('contains expected pawn and knight moves from the start position', () => {
    const moves = legalMovesUci(posFromFen(START_FEN));
    expect(moves).toContain('e2e4');
    expect(moves).toContain('e2e3');
    expect(moves).toContain('g1f3');
    expect(moves).toContain('b1c3');
  });

  it('returns an empty array from a checkmate position', () => {
    expect(legalMovesUci(posFromFen(FOOLS_MATE_FEN))).toHaveLength(0);
  });
});

// ─── legalDestsCg ────────────────────────────────────────────────────────────

describe('legalDestsCg', () => {
  it('returns a Map instance from the start position', () => {
    const dests = legalDestsCg(posFromFen(START_FEN));
    expect(dests).toBeInstanceOf(Map);
  });

  it('keys and values are algebraic square names (Key = SquareName)', () => {
    const dests = legalDestsCg(posFromFen(START_FEN));
    // e2 pawn can go to e3 and e4
    expect(dests.has('e2')).toBe(true);
    const e2dests = dests.get('e2')!;
    expect(e2dests).toContain('e3');
    expect(e2dests).toContain('e4');
  });
});

// ─── sanOf ───────────────────────────────────────────────────────────────────

describe('sanOf', () => {
  it('converts e2e4 to e4 from start position', () => {
    expect(sanOf(posFromFen(START_FEN), 'e2e4')).toBe('e4');
  });

  it('converts g1f3 to Nf3 from start position', () => {
    expect(sanOf(posFromFen(START_FEN), 'g1f3')).toBe('Nf3');
  });
});

// ─── variationSan ────────────────────────────────────────────────────────────

describe('variationSan', () => {
  it('produces numbered SAN for 1.e4 e5 2.Nf3', () => {
    const result = variationSan(posFromFen(START_FEN), ['e2e4', 'e7e5', 'g1f3']);
    expect(result).toBe('1. e4 e5 2. Nf3');
  });

  it('returns empty string for an empty move list', () => {
    expect(variationSan(posFromFen(START_FEN), [])).toBe('');
  });
});

// ─── outcomeOf ───────────────────────────────────────────────────────────────

describe('outcomeOf', () => {
  it('returns null for the start position (game in progress)', () => {
    expect(outcomeOf(posFromFen(START_FEN))).toBeNull();
  });

  it('returns checkmate outcome for fool\'s mate position', () => {
    const outcome = outcomeOf(posFromFen(FOOLS_MATE_FEN));
    expect(outcome).not.toBeNull();
    expect(outcome!.result).toBe('0-1');
    expect(outcome!.reason).toBe('checkmate');
  });

  it('returns stalemate outcome for the stalemate position', () => {
    const outcome = outcomeOf(posFromFen(STALEMATE_FEN));
    expect(outcome).not.toBeNull();
    expect(outcome!.result).toBe('1/2-1/2');
    expect(outcome!.reason).toBe('stalemate');
  });
});

// ─── playUci ─────────────────────────────────────────────────────────────────

describe('playUci', () => {
  it('plays a legal move and returns the new position', () => {
    const pos = posFromFen(START_FEN);
    const after = playUci(pos, 'e2e4');
    // new position has e4 pawn — FEN should reflect the move
    expect(fenOf(after)).toContain('4P3');
    // input position is not mutated
    expect(fenOf(pos)).toBe(START_FEN);
  });

  it('advances the turn after a move', () => {
    const pos = posFromFen(START_FEN);
    const after = playUci(pos, 'e2e4');
    expect(after.turn).toBe('black');
  });

  it('throws on an illegal move', () => {
    expect(() => playUci(posFromFen(START_FEN), 'e2e5')).toThrow();
  });

  it('throws on a syntactically invalid UCI string', () => {
    expect(() => playUci(posFromFen(START_FEN), 'invalid')).toThrow();
  });
});

// ─── attackedBy ──────────────────────────────────────────────────────────────

describe('attackedBy', () => {
  // From the start position, white pawns at a2-h2 each attack the square in
  // front-diagonally. a2 pawn attacks b3; c2 pawn attacks b3.
  it('detects that b3 is attacked by white from the start position', () => {
    expect(attackedBy(posFromFen(START_FEN), 'b3', 'white')).toBe(true);
  });

  // e5 is far from all white pieces in the start position — not attacked.
  it('detects that e5 is NOT attacked by white from the start position', () => {
    expect(attackedBy(posFromFen(START_FEN), 'e5', 'white')).toBe(false);
  });

  // After 1.e4, d3 is attacked by the pawn on e4 (white) and not by black.
  it('detects that d3 is attacked by white after e4 is played', () => {
    const pos = playUci(posFromFen(START_FEN), 'e2e4');
    expect(attackedBy(pos, 'd3', 'white')).toBe(true);
    expect(attackedBy(pos, 'd3', 'black')).toBe(false);
  });

  // Also accepts a numeric Square (0–63): e4 = file 4, rank 3 → square 28
  it('accepts a numeric Square index', () => {
    // b3 = file 1, rank 2 → square index 17
    expect(attackedBy(posFromFen(START_FEN), 17, 'white')).toBe(true);
  });
});
