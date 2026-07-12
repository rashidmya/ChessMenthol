export interface Corner { leftPct: number; topPct: number; }

/** Top-right corner of `square` (e.g. "e5") as percentages of board width/height,
 *  in the displayed frame for the given orientation. Matches the chessground layout:
 *  file a→h left→right and rank 8→1 top→bottom when White is at the bottom; both
 *  axes flip when Black is at the bottom. Pure — no DOM. */
export function squareCorner(square: string, orientation: 'white' | 'black'): Corner {
  const fileIdx = square.charCodeAt(0) - 97; // 'a' -> 0 ... 'h' -> 7
  const rankIdx = Number(square[1]) - 1;     // '1' -> 0 ... '8' -> 7
  const col = orientation === 'white' ? fileIdx : 7 - fileIdx;
  const row = orientation === 'white' ? 7 - rankIdx : rankIdx;
  return { leftPct: ((col + 1) / 8) * 100, topPct: (row / 8) * 100 };
}
