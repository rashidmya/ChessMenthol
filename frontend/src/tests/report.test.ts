import { describe, it, expect } from 'vitest';
import { perSideClassCounts, emptyClassCounts, graphSeries } from '../core/report';
import type { GameReportDto, PlayerReportDto, PlyReportDto } from '../lib/types';

function ply(n: number, label: string | null): PlyReportDto {
  return { ply: n, san: 'x', uci: 'a2a3', winWhite: 50, evalText: '+0.00', cpl: 0,
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

  it('ignores a non-null but unrecognized label for both sides', () => {
    // 'equal' is not one of the 10 MoveClass values; the `label in side` guard drops it.
    const { white, black } = perSideClassCounts([ply(1, 'equal'), ply(2, 'equal')]);
    const total = (c: typeof white) => Object.values(c).reduce((a, b) => a + b, 0);
    expect(total(white)).toBe(0);
    expect(total(black)).toBe(0);
  });

  it('emptyClassCounts has all 10 keys at 0', () => {
    expect(Object.values(emptyClassCounts()).every((v) => v === 0)).toBe(true);
    expect(Object.keys(emptyClassCounts())).toHaveLength(10);
  });
});

describe('graphSeries', () => {
  const emptyPlayer: PlayerReportDto = { accuracy: 0, acpl: 0, ...emptyClassCounts() };
  const inaccuracy = { label: 'inaccuracy', cpl: 60, isBest: false };
  function rp(n: number, san: string, winWhite: number, evalText: string,
              classification: PlyReportDto['classification'] = null): PlyReportDto {
    return { ply: n, san, uci: 'a2a3', winWhite, evalText, cpl: 0, classification };
  }
  const report: GameReportDto = {
    white: emptyPlayer, black: emptyPlayer,
    startWin: 50, startEvalText: '+0.00',
    plies: [
      rp(1, 'e4', 60, '+0.30'),
      rp(2, 'e5', 52, '+0.10'),
      rp(3, 'Nf3', 55, '+0.20', inaccuracy),
    ],
  };

  it('prepends a Start point built from the base position', () => {
    const s = graphSeries(report);
    expect(s).toHaveLength(4); // base + 3 plies
    expect(s[0]).toEqual({ win: 50, evalText: '+0.00', label: 'Start', cls: null });
  });

  it('labels plies like the move list: "N." for White, "N…" for Black', () => {
    const s = graphSeries(report);
    expect(s[1].label).toBe('1. e4');
    expect(s[2].label).toBe('1… e5');
    expect(s[3].label).toBe('2. Nf3');
  });

  it('passes each ply win%, eval text, and classification straight through', () => {
    const s = graphSeries(report);
    expect(s[1]).toEqual({ win: 60, evalText: '+0.30', label: '1. e4', cls: null });
    expect(s[3].win).toBe(55);
    expect(s[3].evalText).toBe('+0.20');
    expect(s[3].cls).toEqual(inaccuracy);
  });
});
