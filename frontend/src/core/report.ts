import type { PlyReportDto } from '../lib/types';

/** Count of each of the 10 move classes for one side. Keys are MoveClass string values. */
export interface ClassCounts {
  brilliant: number; great: number; best: number; excellent: number; good: number;
  book: number; inaccuracy: number; mistake: number; blunder: number; miss: number;
}

export function emptyClassCounts(): ClassCounts {
  return { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0,
           book: 0, inaccuracy: 0, mistake: 0, blunder: 0, miss: 0 };
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
    if (label in side) (side as unknown as Record<string, number>)[label]++;
  }
  return { white, black };
}
