import { describe, it, expect } from 'vitest';
import { cpFromEval, winningChances, winPercent } from '../core/accuracy';
import { moveAccuracy, weightedMean, harmonicMean, populationStdDev } from '../core/accuracy';

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
