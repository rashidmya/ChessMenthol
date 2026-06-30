/** Pure conversion of engine PV lines into chessground auto-shapes (arrows),
 *  mirroring Lichess's analysis board (ui/analyse/src/autoShape.ts):
 *   - the best line (index 0) is a bold blue arrow ('paleBlue', the brush's
 *     default width 15), like Lichess's primary engine move;
 *   - weaker lines are grey ('paleGrey') and get THINNER the more win-chance
 *     they give up versus the best line (lineWidth 12 → 2);
 *   - a line more than ~0.2 win-chance behind the best is dropped entirely,
 *     exactly as Lichess does.
 *  User-drawn arrows are untouched here and stay chessground's default green. */

export interface ShapeModifiers { lineWidth: number; }
export interface Shape {
  orig: string;
  dest: string;
  brush: string;
  modifiers?: ShapeModifiers;
}

/** Just the fields the arrow math needs. `cp`/`mate` are White-relative
 *  (centipawns / moves-to-mate), matching our serialized LineDto. */
export interface ArrowLine { pv: string[]; cp: number | null; mate: number | null; }

// --- Win-chance model, copied verbatim from Lichess's ui/ceval/winningChances.ts ---
function rawWinningChances(cp: number): number {
  const MULTIPLIER = -0.00368208;
  return 2 / (1 + Math.exp(MULTIPLIER * cp)) - 1;
}
function cpWinningChances(cp: number): number {
  return rawWinningChances(Math.min(Math.max(-1000, cp), 1000));
}
function mateWinningChances(mate: number): number {
  const cp = (21 - Math.min(10, Math.abs(mate))) * 100;
  return rawWinningChances(cp * (mate > 0 ? 1 : -1));
}
function evalWinningChances(line: ArrowLine): number {
  if (line.mate !== null) return mateWinningChances(line.mate);
  if (line.cp !== null) return cpWinningChances(line.cp);
  return 0;
}
/** Win chance in [-1, 1] from the side-to-move's POV (our evals are White-POV). */
function povChances(stm: 'white' | 'black', line: ArrowLine): number {
  return evalWinningChances(line) * (stm === 'white' ? 1 : -1);
}
/** Drop in win chance of `line` relative to `best`, side-to-move POV (≈ 0..1). */
function povDiff(stm: 'white' | 'black', best: ArrowLine, line: ArrowLine): number {
  return (povChances(stm, best) - povChances(stm, line)) / 2;
}

/** One arrow per line, from pv[0] (UCI). `stm` is the side to move, needed to
 *  read White-POV evals from the mover's perspective. Empty when hidden, when a
 *  line has no pv, or (for weaker lines) when too far behind the best to draw. */
export function linesToShapes(
  lines: ArrowLine[],
  show: boolean,
  stm: 'white' | 'black' = 'white',
): Shape[] {
  if (!show || lines.length === 0) return [];
  const best = lines[0];
  const shapes: Shape[] = [];
  for (let i = 0; i < lines.length; i++) {
    const uci = lines[i].pv[0];
    if (!uci) continue;
    const orig = uci.slice(0, 2);
    const dest = uci.slice(2, 4);
    if (i === 0) {
      shapes.push({ orig, dest, brush: 'paleBlue' });
      continue;
    }
    const shift = povDiff(stm, best, lines[i]);
    if (shift >= 0 && shift < 0.2) {
      shapes.push({ orig, dest, brush: 'paleGrey', modifiers: { lineWidth: Math.round(12 - shift * 50) } });
    }
  }
  return shapes;
}
