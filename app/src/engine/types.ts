// app/src/engine/types.ts
// White's-point-of-view analysis types. Ported from the original Python chessmenthol/engine/types.py (removed in the Svelte+Tauri migration).
// Plain data (no classes) so values survive structured clone / Svelte stores.

export interface Eval {
  cp: number | null;   // centipawns, White POV (null when forced mate)
  mate: number | null; // mate-in-N, White POV (positive = White mates)
}

export interface Line {
  multipv: number;     // 1-based rank; 1 === best line
  eval: Eval;
  depth: number;
  pv: string[];        // UCI moves, e.g. ['e2e4','e7e5']
}

export interface AnalysisInfo {
  fen: string;
  depth: number;       // max depth across lines
  lines: Line[];       // sorted ascending by multipv (lines[0] === best)
}

const MATE_VALUE = 100_000;

/** Convert a side-to-move-relative score to White POV. */
export function toWhitePov(cp: number | null, mate: number | null, whiteToMove: boolean): Eval {
  if (whiteToMove) return { cp, mate };
  return { cp: cp === null ? null : -cp, mate: mate === null ? null : -mate };
}

/** White-POV centipawn scalar; mate mapped near +/- MATE_VALUE. */
export function evalScalar(e: Eval, mateValue = MATE_VALUE): number {
  if (e.mate !== null) {
    const base = mateValue - Math.abs(e.mate);
    return e.mate > 0 ? base : -base;
  }
  return e.cp ?? 0;
}

/** Scalar from the perspective of the side to move. */
export function evalPov(e: Eval, whiteToMove: boolean, mateValue = MATE_VALUE): number {
  const s = evalScalar(e, mateValue);
  return whiteToMove ? s : -s;
}

/** White-POV display string, e.g. '+0.34', '-1.50', '+M3', '#'. */
export function formatWhiteEval(e: Eval): string {
  if (e.mate !== null) {
    if (e.mate > 0) return `+M${e.mate}`;
    if (e.mate < 0) return `-M${-e.mate}`;
    return '#';
  }
  const pawns = (e.cp ?? 0) / 100;
  const sign = pawns >= 0 ? '+' : '-';
  return `${sign}${Math.abs(pawns).toFixed(2)}`;
}

export function bestLine(info: AnalysisInfo): Line | null {
  return info.lines.length ? info.lines[0] : null;
}

export function lineMove(line: Line): string | null {
  return line.pv.length ? line.pv[0] : null;
}
