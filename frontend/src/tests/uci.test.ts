// frontend/src/tests/uci.test.ts
import { describe, it, expect } from 'vitest';
import { parseInfoLine, sideToMoveIsWhite, goLimitString, buildAnalysisInfo } from '../engine/uci';

describe('sideToMoveIsWhite', () => {
  it('reads the side field from a FEN', () => {
    expect(sideToMoveIsWhite('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(true);
    expect(sideToMoveIsWhite('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1')).toBe(false);
  });
  it('defaults to white on a malformed FEN', () => {
    expect(sideToMoveIsWhite('garbage')).toBe(true);
  });
});

describe('parseInfoLine', () => {
  it('parses depth, multipv, cp score and pv', () => {
    const line = 'info depth 20 seldepth 28 multipv 1 score cp 31 nodes 100 nps 50 time 200 pv e2e4 e7e5 g1f3';
    expect(parseInfoLine(line)).toEqual({ depth: 20, multipv: 1, cp: 31, mate: null, pv: ['e2e4', 'e7e5', 'g1f3'] });
  });
  it('parses mate score', () => {
    const line = 'info depth 12 multipv 2 score mate -3 pv d2d4 d7d5';
    expect(parseInfoLine(line)).toEqual({ depth: 12, multipv: 2, cp: null, mate: -3, pv: ['d2d4', 'd7d5'] });
  });
  it('defaults multipv to 1 and depth to 0 when absent', () => {
    const line = 'info score cp 5 pv e2e4';
    expect(parseInfoLine(line)).toEqual({ depth: 0, multipv: 1, cp: 5, mate: null, pv: ['e2e4'] });
  });
  it('ignores lowerbound/upperbound tokens but keeps the value', () => {
    const line = 'info depth 9 multipv 1 score cp 12 lowerbound pv e2e4';
    expect(parseInfoLine(line)).toEqual({ depth: 9, multipv: 1, cp: 12, mate: null, pv: ['e2e4'] });
  });
  it('returns null for lines without a score', () => {
    expect(parseInfoLine('info depth 1 seldepth 1 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfoLine('info string NNUE evaluation using net.nnue')).toBeNull();
  });
  it('handles an empty pv (score but no moves)', () => {
    expect(parseInfoLine('info depth 30 multipv 1 score cp 0')).toEqual({ depth: 30, multipv: 1, cp: 0, mate: null, pv: [] });
  });
});

describe('goLimitString', () => {
  it('depth only', () => { expect(goLimitString({ depth: 18, timeMs: null })).toBe('go depth 18'); });
  it('movetime only', () => { expect(goLimitString({ depth: null, timeMs: 10000 })).toBe('go movetime 10000'); });
  it('both', () => { expect(goLimitString({ depth: 18, timeMs: 5000 })).toBe('go depth 18 movetime 5000'); });
  it('neither -> infinite', () => { expect(goLimitString({ depth: null, timeMs: null })).toBe('go infinite'); });
});

describe('buildAnalysisInfo', () => {
  it('converts to white POV, sorts by multipv, sets max depth', () => {
    // Black to move: side-to-move cp must be negated to White POV.
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    const m = new Map([
      [2, { depth: 18, multipv: 2, cp: -10, mate: null, pv: ['d7d5'] }],
      [1, { depth: 20, multipv: 1, cp: 40, mate: null, pv: ['e7e5'] }],
    ]);
    const info = buildAnalysisInfo(fen, m);
    expect(info.fen).toBe(fen);
    expect(info.depth).toBe(20);
    expect(info.lines.map((l) => l.multipv)).toEqual([1, 2]);
    expect(info.lines[0]).toEqual({ multipv: 1, eval: { cp: -40, mate: null }, depth: 20, pv: ['e7e5'] });
    expect(info.lines[1].eval).toEqual({ cp: 10, mate: null });
  });
  it('white to move keeps the sign; mate converts too', () => {
    const fen = '7k/8/8/8/8/8/8/6QK w - - 0 1';
    const m = new Map([[1, { depth: 5, multipv: 1, cp: null, mate: 2, pv: ['g1g7'] }]]);
    const info = buildAnalysisInfo(fen, m);
    expect(info.lines[0].eval).toEqual({ cp: null, mate: 2 });
  });
  it('empty map -> no lines, depth 0', () => {
    const info = buildAnalysisInfo('x w - - 0 1', new Map());
    expect(info.lines).toEqual([]);
    expect(info.depth).toBe(0);
  });
});
