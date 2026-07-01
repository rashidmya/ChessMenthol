import { describe, it, expect } from 'vitest';
import { cpFromEval, winningChances, winPercent } from '../core/accuracy';
import { moveAccuracy, weightedMean, harmonicMean, populationStdDev } from '../core/accuracy';
import { gameAccuracy, acpl } from '../core/accuracy';

describe('winPercent / winningChances', () => {
  it('is 50 at cp 0', () => {
    expect(winPercent(0)).toBeCloseTo(50, 6);
    expect(winningChances(0)).toBeCloseTo(0, 6);
  });
  it('clamps cp to ±1000 → ~97.5 / ~2.5', () => {
    expect(winPercent(1000)).toBeCloseTo(97.5447, 2);
    expect(winPercent(-1000)).toBeCloseTo(2.4553, 2);
    expect(winPercent(5000)).toBeCloseTo(winPercent(1000), 6); // ceiled
  });
});

describe('cpFromEval', () => {
  it('maps mate to the signed ±1000 ceiling (White POV)', () => {
    expect(cpFromEval({ cp: null, mate: 3 })).toBe(1000);
    expect(cpFromEval({ cp: null, mate: -2 })).toBe(-1000);
  });
  it('clamps a big cp to ±1000 and passes through small cp', () => {
    expect(cpFromEval({ cp: 4200, mate: null })).toBe(1000);
    expect(cpFromEval({ cp: -35, mate: null })).toBe(-35);
  });
});

describe('moveAccuracy', () => {
  it('is 100 when win% does not drop', () => {
    expect(moveAccuracy(60, 65)).toBe(100);
    expect(moveAccuracy(60, 60)).toBe(100);
  });
  it('applies the Lichess fit (+1 bonus), clamped [0,100]', () => {
    // winDiff = 20 → 103.16681*exp(-0.04354415*20) - 3.16692 + 1 ≈ 41.06
    expect(moveAccuracy(70, 50)).toBeCloseTo(41.06, 1);
    expect(moveAccuracy(100, 0)).toBeGreaterThanOrEqual(0);
    expect(moveAccuracy(100, 0)).toBeLessThanOrEqual(100);
  });
});

describe('Maths helpers', () => {
  it('weightedMean', () => {
    expect(weightedMean([[10, 1], [20, 3]])).toBeCloseTo(17.5, 6);
    expect(weightedMean([])).toBeNull();
  });
  it('harmonicMean guards each term with max(1, v)', () => {
    expect(harmonicMean([2, 2, 2])).toBeCloseTo(2, 6);
    expect(harmonicMean([])).toBeNull();
  });
  it('populationStdDev divides by n', () => {
    expect(populationStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
  });
});

describe('gameAccuracy', () => {
  it('gives near-100 for a dead-level game and lower for the side that drops chances', () => {
    // 6 half-moves, White plays a big blunder on its move that dips to -300 cp.
    // cpsAfterMoves are WHITE-POV cp for positions after each move.
    const cps = [30, 20, 35, 25, -300, 10];
    const { white, black } = gameAccuracy(true, cps);
    expect(white).toBeGreaterThan(0);
    expect(white).toBeLessThan(100);
    expect(black).toBeGreaterThan(white); // White threw chances away, Black didn't
  });
  it('is symmetric-ish for a perfectly level game', () => {
    const cps = [15, 15, 15, 15];
    const { white, black } = gameAccuracy(true, cps);
    expect(white).toBeCloseTo(100, 0);
    expect(black).toBeCloseTo(100, 0);
  });
});

describe('acpl', () => {
  it('averages each colour’s per-move centipawn loss (mover POV, capped)', () => {
    // positions 0..4 (start + 4 moves), White POV cp. White moves = 1,3; Black = 2,4.
    const cps = [20, 10, 40, 30, -260];
    // White losses: move1 (20->10)=10 ; move3 (40->30)=10 → mean 10
    // Black losses (mover POV = NEGATE the White-POV delta):
    //   move2: cps 10->40, Black got worse by 30 → loss 30
    //   move4: cps 30->-260 (Black now WINNING by 260) → Black improved, loss 0
    //   → mean (30+0)/2 = 15
    expect(acpl(cps, true, 'white')).toBe(10);
    expect(acpl(cps, true, 'black')).toBe(15);
  });
});
