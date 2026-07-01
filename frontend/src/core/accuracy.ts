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

const CP_INITIAL = 15; // scalachess Eval.Cp.initial — seeded as position 0 in game accuracy

/**
 * AccuracyPercent.gameAccuracy — per-colour game accuracy.
 * @param startWhite  true if White moves first at the base position
 * @param cpsAfterMoves  White-POV cp for the position AFTER each move (length = #moves)
 */
export function gameAccuracy(startWhite: boolean, cpsAfterMoves: (number | null)[]): { white: number; black: number } {
  const allWin: (number | null)[] = [winPercent(CP_INITIAL), ...cpsAfterMoves.map((c) => (c === null ? null : winPercent(c)))];
  const n = cpsAfterMoves.length;
  if (n === 0) return { white: 100, black: 100 };

  const windowSize = clamp(Math.floor(n / 10), 2, 8);
  // (windowSize - 2) leading copies of the first window, then every sliding window.
  const windows: (number | null)[][] = [];
  const firstWindow = allWin.slice(0, Math.min(windowSize, allWin.length));
  for (let i = 0; i < Math.max(0, Math.min(windowSize, allWin.length) - 2); i++) windows.push(firstWindow);
  for (let i = 0; i + windowSize <= allWin.length; i++) windows.push(allWin.slice(i, i + windowSize));

  const weightAt = (i: number): number => {
    const w = windows[Math.min(i, windows.length - 1)] ?? firstWindow;
    const vals = w.filter((x): x is number => x !== null);
    return clamp(populationStdDev(vals), 0.5, 12);
  };

  // Per-move accuracy from sliding pairs; colour = mover of move (i+1).
  const per: { acc: number; weight: number; white: boolean }[] = [];
  for (let i = 1; i < allWin.length; i++) {
    const before = allWin[i - 1], after = allWin[i];
    if (before === null || after === null) continue;
    const moverWhite = startWhite ? (i % 2 === 1) : (i % 2 === 0);
    // mover-POV win%: White uses win% directly, Black uses 100 - win%.
    const b = moverWhite ? before : 100 - before;
    const a = moverWhite ? after : 100 - after;
    per.push({ acc: moveAccuracy(b, a), weight: weightAt(i - 1), white: moverWhite });
  }

  const forColour = (white: boolean): number => {
    const rows = per.filter((p) => p.white === white);
    if (rows.length === 0) return 100;
    const weighted = weightedMean(rows.map((r) => [r.acc, r.weight] as [number, number]));
    const harmonic = harmonicMean(rows.map((r) => r.acc));
    if (weighted === null || harmonic === null) return 100;
    return clamp((weighted + harmonic) / 2, 0, 100);
  };

  return { white: forColour(true), black: forColour(false) };
}

/**
 * AccuracyCP.mean — average centipawn loss for one colour.
 * @param cpsPositions  White-POV cp for positions 0..N (start + after each move)
 */
export function acpl(cpsPositions: number[], startWhite: boolean, color: 'white' | 'black'): number {
  const losses: number[] = [];
  for (let k = 1; k < cpsPositions.length; k++) {
    const moverWhite = startWhite ? (k % 2 === 1) : (k % 2 === 0);
    if (moverWhite !== (color === 'white')) continue;
    const drop = (cpsPositions[k - 1] - cpsPositions[k]) * (moverWhite ? 1 : -1);
    losses.push(Math.max(0, drop));
  }
  if (losses.length === 0) return 0;
  return Math.round(losses.reduce((a, b) => a + b, 0) / losses.length);
}
