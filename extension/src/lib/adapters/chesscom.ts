import { assembleFromGrid } from '@core/core/chess';
import type { AdapterPosition, SiteAdapter } from './types';

const CODE_RE = /\b([wb])([pnbrqk])\b/; // e.g. 'wp', 'bk' -> ['w','p']/['b','k']
const SQ_RE = /\bsquare-(\d)(\d)\b/;        // file, rank (1..8, absolute White's view)

function boardEl(): Element | null {
  return document.querySelector('wc-chess-board, .board .pieces, .board');
}

/** Build the white-bottom grid assembleFromGrid expects from chess.com pieces.
 *  `assembleFromGrid`'s codes need an UPPERCASE role letter ('wP'/'bK', matching
 *  the vision classifier's CLASSES format) — chess.com's own class names are
 *  lowercase ('wp'/'bk'), so the role char is upper-cased here. */
function readGrid(board: Element): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: 8 }, () =>
    Array<string | null>(8).fill(null),
  );
  for (const el of board.querySelectorAll('.piece')) {
    const cls = el.className;
    const code = cls.match(CODE_RE);
    const sq = cls.match(SQ_RE);
    if (!code || !sq) continue;
    const file = Number(sq[1]); // 1..8
    const rank = Number(sq[2]); // 1..8
    grid[8 - rank][file - 1] = code[1] + code[2].toUpperCase(); // white-bottom frame
  }
  return grid;
}

/** Side to move from the last-move highlight: the highlighted square that still
 *  holds a piece is the mover's destination ⇒ opposite side is to move. */
function readTurn(board: Element, grid: (string | null)[][]): 'w' | 'b' {
  for (const hl of board.querySelectorAll('.highlight')) {
    const sq = hl.className.match(SQ_RE);
    if (!sq) continue;
    const file = Number(sq[1]); const rank = Number(sq[2]);
    const code = grid[8 - rank][file - 1];
    if (code) return code[0] === 'w' ? 'b' : 'w';
  }
  return 'w';
}

export const chesscomAdapter: SiteAdapter = {
  site: 'chesscom',
  matches: (url) => /(^|\.)chess\.com$/.test(hostOf(url)),

  readPosition(): AdapterPosition | null {
    const board = boardEl();
    if (!board) return null;
    const grid = readGrid(board);
    const turn = readTurn(board, grid);
    const res = assembleFromGrid(grid, { white: turn === 'w' });
    if (!res.isLegal) return null;
    const orientation = board.classList.contains('flipped') ? 'black' : 'white';
    return { fen: res.fen, orientation, turn };
  },

  // Live observation is wired in Task 4 (observeBoard). No-op until then.
  observe: () => () => {},
};

function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return ''; } }
