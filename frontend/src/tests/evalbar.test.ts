import { describe, it, expect } from 'vitest';
import { whitePct } from '../lib/evalbar';

describe('whitePct', () => {
  it('is 50 for a null eval and ~50 for a dead-even cp', () => {
    expect(whitePct(null)).toBe(50);
    expect(whitePct({ cp: 0, mate: null, text: '+0.00' })).toBeCloseTo(50, 5);
  });
  it('rises above 50 when White is better and below 50 when worse', () => {
    expect(whitePct({ cp: 300, mate: null, text: '+3.00' })).toBeGreaterThan(50);
    expect(whitePct({ cp: -300, mate: null, text: '-3.00' })).toBeLessThan(50);
  });
  it('clamps mate to the extremes', () => {
    expect(whitePct({ cp: null, mate: 2, text: '#2' })).toBe(100);
    expect(whitePct({ cp: null, mate: -2, text: '#-2' })).toBe(0);
  });
});
