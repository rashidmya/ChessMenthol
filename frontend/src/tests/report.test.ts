import { describe, it, expect } from 'vitest';
import { perSideClassCounts, emptyClassCounts } from '../core/report';
import type { PlyReportDto } from '../lib/types';

function ply(n: number, label: string | null): PlyReportDto {
  return { ply: n, san: 'x', uci: 'a2a3', winWhite: 50, cpl: 0,
    classification: label ? { label, cpl: 0, isBest: false } : null };
}

describe('perSideClassCounts', () => {
  it('starts every class at 0 for both sides', () => {
    const { white, black } = perSideClassCounts([]);
    for (const c of ['brilliant','great','best','excellent','good','book','inaccuracy','mistake','blunder','miss'] as const) {
      expect(white[c]).toBe(0); expect(black[c]).toBe(0);
    }
  });

  it('attributes odd plies to White and even plies to Black, by class', () => {
    const plies = [
      ply(1, 'brilliant'), // white
      ply(2, 'blunder'),   // black
      ply(3, 'best'),      // white
      ply(4, 'miss'),      // black
      ply(5, 'best'),      // white
      ply(6, null),        // black, unclassified -> ignored
    ];
    const { white, black } = perSideClassCounts(plies);
    expect(white.brilliant).toBe(1);
    expect(white.best).toBe(2);
    expect(black.blunder).toBe(1);
    expect(black.miss).toBe(1);
    expect(black.brilliant).toBe(0);
  });

  it('attributes by mover color, not ply parity, when Black starts', () => {
    // startWhite=false: ply 1 is Black's move, ply 2 is White's.
    const { white, black } = perSideClassCounts([ply(1, 'blunder'), ply(2, 'best')], false);
    expect(black.blunder).toBe(1);
    expect(white.best).toBe(1);
    expect(white.blunder).toBe(0);
  });

  it('emptyClassCounts has all 10 keys at 0', () => {
    expect(Object.values(emptyClassCounts()).every((v) => v === 0)).toBe(true);
    expect(Object.keys(emptyClassCounts())).toHaveLength(10);
  });
});
