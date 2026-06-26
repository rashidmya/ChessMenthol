/** Pure conversion of engine PV lines into chessground auto-shapes (arrows). */
export interface Shape { orig: string; dest: string; brush: string; }

/** One arrow per line, taken from pv[0] (UCI). Best move (index 0) uses 'green',
 *  lower lines use 'paleBlue'. Empty when hidden or when a line has no pv.
 *  Note: index 0 stays 'green' even after empty-pv lines are filtered out. */
export function linesToShapes(lines: { pv: string[] }[], show: boolean): Shape[] {
  if (!show) return [];
  const shapes: Shape[] = [];
  for (let i = 0; i < lines.length; i++) {
    const uci = lines[i].pv[0];
    if (!uci) continue;
    shapes.push({
      orig: uci.slice(0, 2),
      dest: uci.slice(2, 4),
      brush: i === 0 ? 'green' : 'paleBlue',
    });
  }
  return shapes;
}
