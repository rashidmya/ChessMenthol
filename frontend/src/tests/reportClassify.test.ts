/**
 * src/tests/reportClassify.test.ts
 *
 * Focused band tests for the Lichess winning-chances ?!/?/?? classification
 * added in the PGN-import / computer-analysis-report feature.
 *
 * Uses the real classifyMove with four cp values chosen so that the
 * mover-POV winningChances drop lands squarely in each band:
 *   before best = +40 cp  → prevWC ≈ 0.0735
 *   cp=-260 → delta≈0.52  (BLUNDER   ≥0.30)
 *   cp=-110 → delta≈0.27  (MISTAKE   ≥0.20 <0.30)
 *   cp=-35  → delta≈0.14  (INACCURACY≥0.10 <0.20)
 *   cp=+30  → delta≈0.018 (small drop <0.10 → GOOD/EXCELLENT)
 */

import { describe, it, expect } from 'vitest';
import { classifyMove, MoveClass } from '../core/classify';
import { posFromFen } from '../core/chess';
import type { AnalysisInfo } from '../engine/types';

// Helper: single-line AnalysisInfo with a given White-POV cp and optional best PV.
function info(fen: string, cpValue: number, bestPv: string[]): AnalysisInfo {
  return {
    fen,
    depth: 20,
    lines: [{ multipv: 1, eval: { cp: cpValue, mate: null }, depth: 20, pv: bestPv }],
  };
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('winning-chances classification bands (White to move)', () => {
  const pos = posFromFen(START);
  // White to move. Best line before = e2e4 at +40 cp.
  // Played move is g1f3 (not the best), so rules 1-4 don't fire.
  // bestMover = +40 < missWin(200), so rule 5 (Miss) doesn't fire either.
  // We vary the AFTER eval to land in each band.
  const before = info(START, 40, ['e2e4']);

  it('flags a blunder at a ≥0.30 winning-chances drop', () => {
    const after = info('after', -260, []); // delta ≈ 0.52
    const c = classifyMove(pos, 'g1f3', before, after);
    expect(c.label).toBe(MoveClass.BLUNDER);
  });

  it('flags a mistake at a drop in [0.20, 0.30)', () => {
    const after = info('after', -110, []); // delta ≈ 0.27
    const c = classifyMove(pos, 'g1f3', before, after);
    expect(c.label).toBe(MoveClass.MISTAKE);
  });

  it('flags an inaccuracy at a drop in [0.10, 0.20)', () => {
    const after = info('after', -35, []); // delta ≈ 0.14
    const c = classifyMove(pos, 'g1f3', before, after);
    expect(c.label).toBe(MoveClass.INACCURACY);
  });

  it('a small drop (<0.10) is good/excellent, not an inaccuracy', () => {
    const after = info('after', 30, []); // delta ≈ 0.018
    const c = classifyMove(pos, 'g1f3', before, after);
    expect([MoveClass.EXCELLENT, MoveClass.GOOD]).toContain(c.label);
  });
});
