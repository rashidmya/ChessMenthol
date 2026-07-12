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

// Helper: single-line AnalysisInfo with a White-POV mate score (+ = White mates).
function infoMate(fen: string, mate: number, bestPv: string[]): AnalysisInfo {
  return {
    fen,
    depth: 20,
    lines: [{ multipv: 1, eval: { cp: null, mate }, depth: 20, pv: bestPv }],
  };
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// After 1.e4 — Black to move (used for the Black-mover mate case).
const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

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

  // DISCRIMINATOR: a clearly-winning position with a moderate cp dip.
  // Winning-chances is saturated up here, so a large cpl is only a small WC swing.
  //   before best = +800 cp (best d2d4), played g1f3 → +500 cp.  cpl = 300.
  //   OLD cpl-band ladder: cpl 300 > mistakeMax(250) → BLUNDER.
  //   NEW winning-chances: winningChances(800) − winningChances(500)
  //                        ≈ 0.900 − 0.726 = 0.174  → INACCURACY.
  // Rule 5 (Miss) does NOT fire: played +500 is not < missKeep(100).
  // This case therefore ONLY passes with the winning-chances block; a revert to
  // the cpl ladder would return BLUNDER and fail here.
  it('grades a moderate dip in a winning position as INACCURACY (not the old BLUNDER)', () => {
    const beforeWinning = info(START, 800, ['d2d4']);
    const after = info('after', 500, []);
    const c = classifyMove(pos, 'g1f3', beforeWinning, after);
    expect(c.label).toBe(MoveClass.INACCURACY);
  });
});

// ─── Mate-advice branch (mateCreated / mateLost) ─────────────────────────────
// Direct coverage for the mate-involved sub-branch of classifyMove, which the
// cp-only band tests never exercise.  Each case picks evals so rules 1-5 (esp.
// Miss) don't intercept before the mate branch is reached.
describe('mate advice', () => {
  const whitePos = posFromFen(START);
  const blackPos = posFromFen(BLACK_TO_MOVE);

  // mateCreated → BLUNDER.
  // White to move. Best before = +40cp (best d2d4), played g1f3 walks into
  // Black's mate-in-2 → after = mate:-2.  moverSign=+1 → mateCreated (afterMate<0).
  // Miss cannot fire: bestMover=40 < missWin(200).  prevCp=40 ≥ -700 → BLUNDER.
  it('mateCreated (walked into being mated) → BLUNDER', () => {
    const before = info(START, 40, ['d2d4']);
    const after = infoMate('after', -2, []);
    const c = classifyMove(whitePos, 'g1f3', before, after);
    expect(c.label).toBe(MoveClass.BLUNDER);
  });

  // mateLost → BLUNDER.
  // White to move. Best before = mate:3 (forced mate), played g1f3 throws the
  // mate but stays winning → after = +500cp.  mateLost (had mate, now cp-only).
  // Miss cannot fire: bestMover≈+1000(mate)≥200 BUT played=+500 is NOT <100.
  // curCp=500 (not >700) → BLUNDER.
  it('mateLost, still only +500 → BLUNDER', () => {
    const before = infoMate(START, 3, ['d2d4']);
    const after = info('after', 500, []);
    const c = classifyMove(whitePos, 'g1f3', before, after);
    expect(c.label).toBe(MoveClass.BLUNDER);
  });

  // mateLost → MISTAKE.
  // Same, but the dropped-to eval is bigger (+800cp) → curCp=800 >700 → MISTAKE.
  it('mateLost, dropped to +800 → MISTAKE', () => {
    const before = infoMate(START, 3, ['d2d4']);
    const after = info('after', 800, []);
    const c = classifyMove(whitePos, 'g1f3', before, after);
    expect(c.label).toBe(MoveClass.MISTAKE);
  });

  // mateLost → INACCURACY.
  // +2000cp is ceiled to +1000 by cpFromEval → curCp=1000 >999 → INACCURACY.
  it('mateLost, still crushing (+2000 → ceiled 1000) → INACCURACY', () => {
    const before = infoMate(START, 3, ['d2d4']);
    const after = info('after', 2000, []);
    const c = classifyMove(whitePos, 'g1f3', before, after);
    expect(c.label).toBe(MoveClass.INACCURACY);
  });

  // Black-to-move mate case — confirms moverSign=-1 handling.
  // Black to move (after 1.e4). Best before = +40cp White-POV (best c7c5), so
  // from Black's POV bestMover=-40 → Miss can't fire (bestMover < missWin).
  // Played g8f6 → after = mate:+2 (White mates Black).  moverSign=-1 →
  // afterMate*sign = -2 < 0 → mateCreated.  prevCp=-40 ≥ -700 → BLUNDER.
  it('mateCreated for a Black mover → BLUNDER', () => {
    const before = info(BLACK_TO_MOVE, 40, ['c7c5']);
    const after = infoMate('after', 2, []);
    const c = classifyMove(blackPos, 'g8f6', before, after);
    expect(c.label).toBe(MoveClass.BLUNDER);
  });
});
