/**
 * core/accuracy.ts — pure Lichess-parity analysis math.
 * Constants verified against scalachess (eval.scala), lila
 * (AccuracyPercent.scala, AccuracyCP.scala) and scalalib (Maths.scala).
 * No chessops import.
 */
import type { Eval } from '../engine/types';

const CP_CEILING = 1000;                 // scalachess Eval.Cp.CEILING
const WIN_MULTIPLIER = -0.00368208;      // scalachess winningChances (lila #11148)

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** White-POV centipawns, clamped to ±1000; mate → signed ceiling. */
export function cpFromEval(e: Eval): number {
  if (e.mate !== null) return e.mate > 0 ? CP_CEILING : -CP_CEILING;
  return clamp(e.cp ?? 0, -CP_CEILING, CP_CEILING);
}

/** Winning chances in [-1, +1]. NOTE: the classifier uses this scale. */
export function winningChances(cp: number): number {
  return clamp(2 / (1 + Math.exp(WIN_MULTIPLIER * cp)) - 1, -1, 1);
}

/** Win% in [0, 100]; cp pre-ceiled to ±1000. */
export function winPercent(cp: number): number {
  return 50 + 50 * winningChances(clamp(cp, -CP_CEILING, CP_CEILING));
}

// AccuracyPercent.fromWinPercents (lila) — before/after are mover-POV win% (0..100).
export function moveAccuracy(beforeWin: number, afterWin: number): number {
  if (afterWin >= beforeWin) return 100;
  const winDiff = beforeWin - afterWin;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) - 3.166924740191411;
  return clamp(raw + 1, 0, 100); // +1 uncertainty bonus
}

// scalalib Maths.weightedMean — Σ(v*w)/Σ(w); null if Σw == 0.
export function weightedMean(pairs: [number, number][]): number | null {
  let sv = 0, sw = 0;
  for (const [v, w] of pairs) { sv += v * w; sw += w; }
  return sw === 0 ? null : sv / sw;
}

// scalalib Maths.harmonicMean — n / Σ(1/max(1,v)); null if empty.
export function harmonicMean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const v of xs) s += 1 / Math.max(1, v);
  return xs.length / s;
}

// scalalib Maths.standardDeviation — population (÷ n).
export function populationStdDev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
  return Math.sqrt(variance);
}
