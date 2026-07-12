// app/src/engine/uci.ts
import type { AnalysisInfo, Eval, Line } from './types';
import { toWhitePov } from './types';

export interface ParsedInfo {
  depth: number;
  multipv: number;
  cp: number | null;   // side-to-move relative (convert with toWhitePov)
  mate: number | null; // side-to-move relative
  pv: string[];
}

/** Side to move from a FEN's 2nd field; defaults to White if malformed. */
export function sideToMoveIsWhite(fen: string): boolean {
  return fen.split(' ')[1] !== 'b';
}

/** Parse one UCI `info` line. Returns null if it carries no score. */
export function parseInfoLine(line: string): ParsedInfo | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'info') return null;
  let depth = 0;
  let multipv = 1;
  let cp: number | null = null;
  let mate: number | null = null;
  let pv: string[] = [];
  let hasScore = false;
  for (let i = 1; i < t.length; i++) {
    const tok = t[i];
    if (tok === 'depth') { depth = parseInt(t[++i], 10); }
    else if (tok === 'multipv') { multipv = parseInt(t[++i], 10); }
    else if (tok === 'score') {
      const kind = t[++i];
      const val = parseInt(t[++i], 10);
      if (kind === 'cp') { cp = val; mate = null; hasScore = true; }
      else if (kind === 'mate') { mate = val; cp = null; hasScore = true; }
    }
    else if (tok === 'pv') { pv = t.slice(i + 1); break; } // pv is always last
    // everything else (seldepth, nodes, nps, hashfull, tbhits, time,
    // currmove, currmovenumber, lowerbound, upperbound, ...) is ignored
  }
  if (!hasScore) return null;
  return { depth, multipv, cp, mate, pv };
}

export interface GoLimit { depth: number | null; timeMs: number | null; }

/** Build the UCI `go` command from a search limit. */
export function goLimitString(limit: GoLimit): string {
  const parts: string[] = [];
  if (limit.depth !== null) parts.push(`depth ${limit.depth}`);
  if (limit.timeMs !== null) parts.push(`movetime ${limit.timeMs}`);
  return parts.length ? `go ${parts.join(' ')}` : 'go infinite';
}

export function buildAnalysisInfo(
  fen: string,
  lineByMultipv: Map<number, ParsedInfo>,
): AnalysisInfo {
  const whiteToMove = sideToMoveIsWhite(fen);
  const lines: Line[] = [];
  for (const p of lineByMultipv.values()) {
    const ev: Eval = toWhitePov(p.cp, p.mate, whiteToMove);
    lines.push({ multipv: p.multipv, eval: ev, depth: p.depth, pv: p.pv });
  }
  lines.sort((a, b) => a.multipv - b.multipv);
  const depth = lines.reduce((mx, l) => Math.max(mx, l.depth), 0);
  return { fen, depth, lines };
}
