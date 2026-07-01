import { describe, it, expect } from 'vitest';
import { cpFromEval, winningChances, winPercent } from '../core/accuracy';

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
