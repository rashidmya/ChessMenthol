import type { ClassificationDto, GameReportDto, PlyReportDto } from '../lib/types';

/** Count of each of the 10 move classes for one side. Keys are MoveClass string values. */
export interface ClassCounts {
  brilliant: number; great: number; best: number; excellent: number; good: number;
  book: number; inaccuracy: number; mistake: number; blunder: number; miss: number;
}

export function emptyClassCounts(): ClassCounts {
  return { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0,
           book: 0, inaccuracy: 0, mistake: 0, blunder: 0, miss: 0 };
}

/** One point on the eval graph: White-POV win% (0..100), the White-POV eval text
 *  for the tooltip, a move label, and the move's classification (null for the base
 *  point or an unclassified ply). */
export interface GraphPoint { win: number; evalText: string; label: string; cls: ClassificationDto | null; }

/** Build the eval-graph series for a report: a base "Start" point followed by one
 *  point per ply. Move labels mirror the move list (`floor((ply-1)/2)+1`, odd ply =
 *  White) so the graph tooltip always reads the same as MoveHistory beside it. */
export function graphSeries(report: GameReportDto): GraphPoint[] {
  const points: GraphPoint[] = [
    { win: report.startWin, evalText: report.startEvalText, label: 'Start', cls: null },
  ];
  for (const p of report.plies) {
    const moveNo = Math.floor((p.ply - 1) / 2) + 1;
    const label = p.ply % 2 === 1 ? `${moveNo}. ${p.san}` : `${moveNo}… ${p.san}`;
    points.push({ win: p.winWhite, evalText: p.evalText, label, cls: p.classification });
  }
  return points;
}

/** Tally classified plies into per-side class counts, attributing each ply to the
 *  side that actually moved. `startWhite` = White moves on ply 1 (false for a game
 *  starting from a Black-to-move position). Unclassified/unknown labels are ignored. */
export function perSideClassCounts(
  plies: PlyReportDto[],
  startWhite = true,
): { white: ClassCounts; black: ClassCounts } {
  const white = emptyClassCounts();
  const black = emptyClassCounts();
  for (const p of plies) {
    const label = p.classification?.label;
    if (!label) continue;
    const moverWhite = startWhite ? p.ply % 2 === 1 : p.ply % 2 === 0;
    const side = moverWhite ? white : black;
    if (label in side) side[label as keyof ClassCounts]++;
  }
  return { white, black };
}
