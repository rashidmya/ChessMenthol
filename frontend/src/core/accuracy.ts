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
