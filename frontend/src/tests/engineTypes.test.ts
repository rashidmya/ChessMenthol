// frontend/src/tests/engineTypes.test.ts
import { describe, it, expect } from 'vitest';
import {
  toWhitePov, evalScalar, evalPov, formatWhiteEval, bestLine, lineMove,
  type Eval, type Line, type AnalysisInfo,
} from '../engine/types';

describe('toWhitePov', () => {
  it('keeps side-to-move score when white to move', () => {
    expect(toWhitePov(34, null, true)).toEqual({ cp: 34, mate: null });
    expect(toWhitePov(null, 3, true)).toEqual({ cp: null, mate: 3 });
  });
  it('negates score when black to move', () => {
    expect(toWhitePov(34, null, false)).toEqual({ cp: -34, mate: null });
    expect(toWhitePov(null, 3, false)).toEqual({ cp: null, mate: -3 });
    expect(toWhitePov(null, -2, false)).toEqual({ cp: null, mate: 2 });
  });
});

describe('evalScalar / evalPov', () => {
  it('returns cp directly for non-mate', () => {
    expect(evalScalar({ cp: 120, mate: null })).toBe(120);
    expect(evalScalar({ cp: -45, mate: null })).toBe(-45);
  });
  it('maps mate near +/- mate_value, sooner mate = larger magnitude', () => {
    expect(evalScalar({ cp: null, mate: 1 })).toBe(99_999);
    expect(evalScalar({ cp: null, mate: 5 })).toBe(99_995);
    expect(evalScalar({ cp: null, mate: -1 })).toBe(-99_999);
  });
  it('treats empty eval as 0', () => {
    expect(evalScalar({ cp: null, mate: null })).toBe(0);
  });
  it('evalPov flips sign for black', () => {
    expect(evalPov({ cp: 50, mate: null }, true)).toBe(50);
    expect(evalPov({ cp: 50, mate: null }, false)).toBe(-50);
  });
});

describe('formatWhiteEval', () => {
  it('formats centipawns to 2 decimals with sign', () => {
    expect(formatWhiteEval({ cp: 34, mate: null })).toBe('+0.34');
    expect(formatWhiteEval({ cp: -150, mate: null })).toBe('-1.50');
    expect(formatWhiteEval({ cp: 0, mate: null })).toBe('+0.00');
  });
  it('formats mate', () => {
    expect(formatWhiteEval({ cp: null, mate: 3 })).toBe('+M3');
    expect(formatWhiteEval({ cp: null, mate: -2 })).toBe('-M2');
    expect(formatWhiteEval({ cp: null, mate: 0 })).toBe('#');
  });
});

describe('bestLine / lineMove', () => {
  const mk = (multipv: number, pv: string[]): Line =>
    ({ multipv, eval: { cp: 0, mate: null }, depth: 10, pv });
  it('bestLine returns the multipv===1 line (lines[0])', () => {
    const info: AnalysisInfo = { fen: 'x', depth: 10, lines: [mk(1, ['e2e4']), mk(2, ['d2d4'])] };
    expect(bestLine(info)?.multipv).toBe(1);
  });
  it('bestLine is null when no lines', () => {
    expect(bestLine({ fen: 'x', depth: 0, lines: [] })).toBeNull();
  });
  it('lineMove returns first pv move or null', () => {
    expect(lineMove(mk(1, ['e2e4', 'e7e5']))).toBe('e2e4');
    expect(lineMove(mk(1, []))).toBeNull();
  });
});
