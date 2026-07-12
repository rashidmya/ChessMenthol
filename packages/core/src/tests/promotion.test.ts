import { describe, it, expect } from 'vitest';
import { promotionPiece } from '../lib/board';

describe('promotionPiece', () => {
  it('returns a queen for a pawn reaching the last rank (white)', () => {
    // White pawn on e7 about to step to e8.
    // NOTE: FEN fixed — the previous FEN had the black king on e8, making e7-e8
    // an illegal blocked push; the old implementation only checked piece type and
    // ignored legality. King moved to h8 so e7-e8 is a genuine legal promotion.
    expect(promotionPiece('7k/4P3/8/8/8/8/8/4K3 w - - 0 1', 'e7', 'e8')).toBe('q');
  });

  it('returns a queen for a pawn reaching the last rank (black)', () => {
    // NOTE: FEN fixed — previous FEN had the white king on e1, blocking e2-e1. King on h1.
    expect(promotionPiece('4k3/8/8/8/8/8/4p3/7K b - - 0 1', 'e2', 'e1')).toBe('q');
  });

  it('returns a queen for a pawn capturing onto the last rank', () => {
    // White pawn g7 captures a rook on h8 -> still a promotion.
    expect(promotionPiece('4k2r/6P1/8/8/8/8/8/4K3 w - - 0 1', 'g7', 'h8')).toBe('q');
  });

  it('returns undefined for a NON-pawn landing on the last rank (the h3f1q bug)', () => {
    // Black bishop h3 captures the white bishop on f1 (lands on rank 1) -> NOT a promotion.
    expect(
      promotionPiece('rn1qkb1r/ppp1pppp/5n2/3p4/5P2/4PNPb/PPPP3P/RNBQKB1R b KQkq - 0 4', 'h3', 'f1'),
    ).toBeUndefined();
  });

  it('returns undefined for an ordinary pawn move that does not reach the last rank', () => {
    expect(promotionPiece('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2', 'e4')).toBeUndefined();
  });

  it('returns undefined for an unparseable FEN rather than guessing a promotion', () => {
    expect(promotionPiece('not a fen', 'h3', 'f1')).toBeUndefined();
  });
});
