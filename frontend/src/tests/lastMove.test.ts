import { describe, it, expect } from 'vitest';
import { currentLastMoveUci, lastMoveSquares } from '../lib/board';

describe('currentLastMoveUci', () => {
  const moves = [{ uci: 'e2e4' }, { uci: 'e7e5' }, { uci: 'g1f3' }];

  it('returns the move that led to the current position', () => {
    expect(currentLastMoveUci(moves, 3)).toBe('g1f3');
    expect(currentLastMoveUci(moves, 2)).toBe('e7e5');
    expect(currentLastMoveUci(moves, 1)).toBe('e2e4');
  });

  it('returns null at the start of the game (no last move to highlight)', () => {
    // This is the New/reset case: history is empty (or cursor at 0) so the
    // previous game's yellow highlight must NOT persist.
    expect(currentLastMoveUci(moves, 0)).toBeNull();
    expect(currentLastMoveUci([], 0)).toBeNull();
  });

  it('is robust to an out-of-range cursor', () => {
    expect(currentLastMoveUci(moves, 99)).toBeNull();
    expect(currentLastMoveUci(moves, -1)).toBeNull();
  });
});

describe('lastMoveSquares', () => {
  it('splits a UCI move into chessground orig/dest keys', () => {
    expect(lastMoveSquares('e2e4')).toEqual(['e2', 'e4']);
  });

  it('drops the promotion suffix (chessground highlights squares, not pieces)', () => {
    expect(lastMoveSquares('e7e8q')).toEqual(['e7', 'e8']);
  });

  it('returns undefined when there is no last move (clears the highlight)', () => {
    // chessground clears state.lastMove only when `lastMove` is present-and-falsy
    // in the config, so the null case must map to undefined, not be omitted.
    expect(lastMoveSquares(null)).toBeUndefined();
  });
});
