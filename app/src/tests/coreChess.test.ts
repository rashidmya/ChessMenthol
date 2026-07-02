// app/src/tests/coreChess.test.ts
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
  roleAt,
  assembleFromGrid,
  boardFenOf,
} from '../core/chess';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MIDGAME_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

// Fool's mate: after 1.f3 e5 2.g4 Qh4#  — white king is mated, black wins
const FOOLS_MATE_FEN = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

// Stalemate: black king at a8, white queen c7, white king b6 — black to move, stalemated
const STALEMATE_FEN = 'k7/2Q5/1K6/8/8/8/8/8 b - - 0 1';

// Promotion-only position: white pawn on a7; the white king on a1 is boxed in
// (black Rh2 covers a2/b2, black Bf5 covers b1) but NOT in check, so white's
// only legal moves are the four a7a8 promotions.
const PROMO_FEN = '4k3/P7/8/5b2/8/8/7r/K7 w - - 0 1';

// King vs King — insufficient material draw.
const KVK_FEN = '8/8/8/8/8/8/8/k1K5 w - - 0 1';

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

  it('expands a promotion into four UCI moves (q/r/b/n)', () => {
    const moves = legalMovesUci(posFromFen(PROMO_FEN));
    expect(moves).toHaveLength(4);
    expect(moves).toContain('a7a8q');
    expect(moves).toContain('a7a8r');
    expect(moves).toContain('a7a8b');
    expect(moves).toContain('a7a8n');
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

  it('throws on an illegal move rather than returning a bogus SAN', () => {
    // 'e2e5' is syntactically valid UCI but illegal; without the legality
    // guard chessops makeSan would silently produce 'e5'.
    expect(() => sanOf(posFromFen(START_FEN), 'e2e5')).toThrow();
  });

  it('throws on a syntactically invalid UCI string', () => {
    expect(() => sanOf(posFromFen(START_FEN), 'invalid')).toThrow();
  });
});

// ─── variationSan ────────────────────────────────────────────────────────────

describe('variationSan', () => {
  it('produces numbered SAN for 1.e4 e5 2.Nf3 (white to move)', () => {
    const result = variationSan(posFromFen(START_FEN), ['e2e4', 'e7e5', 'g1f3']);
    expect(result).toBe('1. e4 e5 2. Nf3');
  });

  // Regression for the python-chess parity fix in core/chess.ts: chessops'
  // makeSanVariation emits "1... e5" (space after the dots) but python-chess
  // (and our serialize parity tests) require "1...e5" with NO space. The regex
  // in variationSan normalises this; lock the black-to-move branch directly.
  it('produces "1...e5 2. Nf3" with NO space after the dots (black to move)', () => {
    const blackToMoveFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const result = variationSan(posFromFen(blackToMoveFen), ['e7e5', 'g1f3']);
    expect(result).toBe('1...e5 2. Nf3');
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

  it('returns insufficient-material outcome for K vs K', () => {
    const outcome = outcomeOf(posFromFen(KVK_FEN));
    expect(outcome).not.toBeNull();
    expect(outcome!.result).toBe('1/2-1/2');
    expect(outcome!.reason).toBe('insufficient material');
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

  // After 1.e4, d3 is attacked by the white f1 bishop along the f1-a6 diagonal
  // (NOT by the e4 pawn — a white pawn on e4 attacks d5/f5, the rank in front).
  it('detects that d3 is attacked by white (f1 bishop) after e4 is played', () => {
    const pos = playUci(posFromFen(START_FEN), 'e2e4');
    expect(attackedBy(pos, 'd3', 'white')).toBe(true);
    expect(attackedBy(pos, 'd3', 'black')).toBe(false);
  });

  // Genuine pawn attack: a white pawn on e4 attacks the two diagonal squares
  // in front of it, d5 and f5.
  it('detects the e4 pawn attacking d5 and f5', () => {
    const pos = playUci(posFromFen(START_FEN), 'e2e4');
    expect(attackedBy(pos, 'd5', 'white')).toBe(true);
    expect(attackedBy(pos, 'f5', 'white')).toBe(true);
  });

  // Also accepts a numeric Square (0–63): e4 = file 4, rank 3 → square 28
  it('accepts a numeric Square index', () => {
    // b3 = file 1, rank 2 → square index 17
    expect(attackedBy(posFromFen(START_FEN), 17, 'white')).toBe(true);
  });
});

// ─── roleAt ──────────────────────────────────────────────────────────────────

describe('roleAt', () => {
  it('returns the role of a piece on an occupied square', () => {
    const pos = posFromFen(START_FEN);
    expect(roleAt(pos, 'e2')).toBe('pawn');   // white pawn
    expect(roleAt(pos, 'd1')).toBe('queen');  // white queen
    expect(roleAt(pos, 'g1')).toBe('knight'); // white knight
  });

  it('returns undefined for an empty square', () => {
    // e4 is empty at the start position
    expect(roleAt(posFromFen(START_FEN), 'e4')).toBeUndefined();
    expect(roleAt(posFromFen(START_FEN), 'd5')).toBeUndefined();
  });

  it('returns the promoted-piece role immediately after a promotion move', () => {
    // PROMO_FEN: white pawn on a7; only legal moves are a7a8{q,r,b,n}
    const pos = posFromFen(PROMO_FEN);
    const afterQ = playUci(pos, 'a7a8q');
    expect(roleAt(afterQ, 'a8')).toBe('queen');
    const afterR = playUci(pos, 'a7a8r');
    expect(roleAt(afterR, 'a8')).toBe('rook');
  });

  it('throws on an unrecognised square string', () => {
    // 'z9' is not a valid algebraic square name; parseSquare returns undefined
    expect(() => roleAt(posFromFen(START_FEN), 'z9' as 'a1')).toThrow('Invalid square');
  });
});

describe('castling UCI — board (chessgroundDests) vs orchestrator (legalMovesUci) must agree', () => {
  // White K e1, rooks a1/h1, full castling rights, white to move.
  const CASTLE_FEN = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';

  it('legalMovesUci includes the king-two-square forms the UI/python-chess send', () => {
    const moves = legalMovesUci(posFromFen(CASTLE_FEN));
    expect(moves).toContain('e1g1'); // kingside (chessground "drop on g1")
    expect(moves).toContain('e1c1'); // queenside
  });

  it('legalMovesUci also accepts the king-takes-rook forms chessgroundDests offers', () => {
    const moves = legalMovesUci(posFromFen(CASTLE_FEN));
    expect(moves).toContain('e1h1');
    expect(moves).toContain('e1a1');
  });

  it('accepts every king destination the board offers (no board move is rejected)', () => {
    const pos = posFromFen(CASTLE_FEN);
    const boardKingDests = legalDestsCg(pos).get('e1' as 'a1') ?? [];
    const legal = new Set(legalMovesUci(pos));
    // chessgroundDests offers the castling king g1, h1, c1, a1 — every one must be
    // a UCI the orchestrator's legality check will accept, or the board can send a
    // move that gets rejected (the castling-breaks-the-board bug).
    for (const to of boardKingDests) {
      expect(legal.has(`e1${to}`)).toBe(true);
    }
  });

  it('playUci/sanOf castle correctly for both UCI forms', () => {
    const pos = posFromFen(CASTLE_FEN);
    expect(sanOf(pos, 'e1g1')).toBe('O-O');
    expect(sanOf(pos, 'e1h1')).toBe('O-O');
    expect(sanOf(pos, 'e1c1')).toBe('O-O-O');
    expect(fenOf(playUci(pos, 'e1g1')).split(' ')[0]).toBe('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R4RK1');
    expect(fenOf(playUci(pos, 'e1c1')).split(' ')[0]).toBe('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/2KR3R');
  });
});

// ─── assembleFromGrid ─────────────────────────────────────────────────────────

describe('assembleFromGrid', () => {
  it('builds the start position from a placement grid (legal)', () => {
    // grid[row][col] in geometric order; row0=a8..h8. null = empty.
    const startGrid = [
      ['bR','bN','bB','bQ','bK','bB','bN','bR'],
      ['bP','bP','bP','bP','bP','bP','bP','bP'],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      ['wP','wP','wP','wP','wP','wP','wP','wP'],
      ['wR','wN','wB','wQ','wK','wB','wN','wR'],
    ];
    const res = assembleFromGrid(startGrid, { white: true });
    expect(res.isLegal).toBe(true);
    expect(res.placement).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    // full castling inferred from kings+rooks on home squares
    expect(res.fen).toContain(' w KQkq ');
  });

  it('flags an illegal two-white-kings placement', () => {
    const grid: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
    grid[0][4] = 'wK'; grid[7][4] = 'wK';
    const res = assembleFromGrid(grid, { white: true });
    expect(res.isLegal).toBe(false);
    expect(res.fen.split(' ')[0]).toBe('4K3/8/8/8/8/8/8/4K3');
  });

  it('boardFenOf returns the placement field of a position', () => {
    expect(boardFenOf(posFromFen(START_FEN))).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  });
});
