import { assembleFromGrid } from '@chessmenthol/core/core/chess';
import type { AdapterPosition, SiteAdapter } from './types';
import { observeBoard } from './observe';

const CODE_RE = /\b([wb])([pnbrqk])\b/; // e.g. 'wp', 'bk' -> ['w','p']/['b','k']
const SQ_RE = /\bsquare-(\d)(\d)\b/;        // file, rank (1..8, absolute White's view)

/** Rank a board candidate: on-screen area in a real browser; piece count as a jsdom
 *  fallback (jsdom has no layout, so getBoundingClientRect returns all zeros). */
function boardScore(el: Element): number {
  const r = el.getBoundingClientRect();
  const area = r.width * r.height;
  return area > 0 ? area : el.querySelectorAll('.piece').length;
}

/** The board to read. Multi-board pages (puzzles / analysis mini-boards) have more
 *  than one candidate, so pick the most prominent rather than the first match. Prefer
 *  the `wc-chess-board` custom element over `.board` wrappers. */
function boardEl(): Element | null {
  const wc = document.querySelectorAll('wc-chess-board');
  const list = wc.length ? [...wc] : [...document.querySelectorAll('.board')];
  if (list.length === 0) return null;
  return list.reduce((best, el) => (boardScore(el) > boardScore(best) ? el : best));
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

/** Normalized inline background-color of a highlight element ('' if none). */
function highlightColor(el: Element): string {
  return (el as HTMLElement).style?.backgroundColor ?? '';
}

/** Side to move from the last-move highlight. chess.com reuses `.highlight` for the
 *  last-move pair AND right-click annotations / selection / premove / check, so trusting
 *  any highlighted occupied square wrongly flips the turn (e.g. touching a piece — see
 *  live DOM: last-move squares are one colour, annotations another, and there is no
 *  dedicated `.last-move` class like lichess). A genuine last move is a same-COLOURED
 *  pair: the destination still holds a piece, the origin is empty. Group highlights by
 *  colour and trust a group only when it looks like a completed move: >=2 squares with
 *  exactly one still occupied (the destination). Require EXACTLY ONE such group — a
 *  same-coloured annotation pair (one occupied, one empty) can also qualify and would
 *  otherwise win by DOM order (chess.com renders annotations before the last-move pair),
 *  so if two rival groups qualify we decline to the White fail-safe rather than risk a
 *  confident wrong flip. Single-square selection/annotation/check never qualifies. */
function readTurn(board: Element, grid: (string | null)[][]): 'w' | 'b' {
  const groups = new Map<string, (string | null)[]>();
  for (const hl of board.querySelectorAll('.highlight')) {
    const sq = hl.className.match(SQ_RE);
    if (!sq) continue;
    const file = Number(sq[1]); const rank = Number(sq[2]);
    const code = grid[8 - rank][file - 1];
    const key = highlightColor(hl);
    let bucket = groups.get(key);
    if (!bucket) { bucket = []; groups.set(key, bucket); }
    bucket.push(code);
  }
  const dests: string[] = [];
  for (const codes of groups.values()) {
    const occupied = codes.filter((c): c is string => c !== null);
    if (codes.length >= 2 && occupied.length === 1) dests.push(occupied[0]);
  }
  if (dests.length !== 1) return 'w';         // 0 = no move; >1 = ambiguous -> fail-safe
  return dests[0][0] === 'w' ? 'b' : 'w';
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

  observe(onChange) {
    const board = boardEl();
    if (!board) return () => {};
    return observeBoard(board, onChange);
  },

  boardPresent: () => !!boardEl(),
};

function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return ''; } }
