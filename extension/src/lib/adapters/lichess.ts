import { assembleFromGrid } from '@core/core/chess';
import type { AdapterPosition, SiteAdapter } from './types';

// UPPERCASE role letters — assembleFromGrid's ROLE_OF is keyed P/N/B/R/Q/K.
const ROLE_CHAR: Record<string, string> = {
  pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K',
};

function boardEl(): Element | null {
  return document.querySelector('cg-board');
}

function squareSize(board: Element): number {
  const w = board.getBoundingClientRect().width;
  return w > 0 ? w / 8 : 0;
}

/** Parse "transform: translate(Xpx, Ypx)" -> [x, y] in px, or null. */
function translateOf(el: Element): [number, number] | null {
  const t = (el as HTMLElement).style.transform;
  const m = t.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function isBlackOriented(): boolean {
  return !!document.querySelector('.cg-wrap.orientation-black, .orientation-black cg-board');
}

/** White-bottom grid coords for a piece/square at pixel (x,y). */
function cell(x: number, y: number, size: number, black: boolean): [number, number] {
  const file = Math.round(x / size);
  const rankFromTop = Math.round(y / size);
  return black ? [7 - rankFromTop, 7 - file] : [rankFromTop, file]; // [row, col]
}

export const lichessAdapter: SiteAdapter = {
  site: 'lichess',
  matches: (url) => /(^|\.)lichess\.org$/.test(hostOf(url)),

  readPosition(): AdapterPosition | null {
    const board = boardEl();
    if (!board) return null;
    const size = squareSize(board);
    if (!size) return null;
    const black = isBlackOriented();

    const grid: (string | null)[][] = Array.from({ length: 8 }, () =>
      Array<string | null>(8).fill(null),
    );
    for (const p of board.querySelectorAll('piece')) {
      const xy = translateOf(p);
      if (!xy) continue;
      const cls = p.className.split(/\s+/);
      const color = cls.includes('white') ? 'w' : cls.includes('black') ? 'b' : null;
      const roleWord = cls.find((c) => c in ROLE_CHAR);
      if (!color || !roleWord) continue;
      const [row, col] = cell(xy[0], xy[1], size, black);
      if (row < 0 || row > 7 || col < 0 || col > 7) continue;
      grid[row][col] = color + ROLE_CHAR[roleWord];
    }

    const turn = readTurn(board, grid, size, black);
    const res = assembleFromGrid(grid, { white: turn === 'w' });
    if (!res.isLegal) return null;
    return { fen: res.fen, orientation: black ? 'black' : 'white', turn };
  },

  // Live observation is wired in Task 4 (observeBoard). No-op until then.
  observe: () => () => {},
};

/** Last-move square that still holds a piece is the mover's destination. */
function readTurn(board: Element, grid: (string | null)[][], size: number, black: boolean): 'w' | 'b' {
  for (const sq of board.querySelectorAll('square.last-move')) {
    const xy = translateOf(sq);
    if (!xy) continue;
    const [row, col] = cell(xy[0], xy[1], size, black);
    const code = grid[row]?.[col];
    if (code) return code[0] === 'w' ? 'b' : 'w';
  }
  return 'w';
}

function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return ''; } }
