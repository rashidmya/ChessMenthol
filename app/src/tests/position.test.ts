/**
 * src/tests/position.test.ts
 *
 * Vitest port of tests/test_position.py (the parity spec). Every assertion
 * reproduces the Python's expected value, mapped onto the TS shapes:
 *   - SquareLabel.piece is a 2-char code ('wP'..'bK') instead of a chess.Piece.
 *   - AssembledPosition holds no chessops board (worker-cloneable plain data),
 *     so `ap.board.board_fen()` -> `ap.fen.split(' ')[0]` and
 *     `ap.board.piece_at(SQ)` -> `pieceCodeAt(posFromFen(ap.fen), 'SQ')`.
 *   - `ap.move == Move.from_uci('e2e4')` -> `ap.move === 'e2e4'`.
 *   - chess.WHITE/BLACK -> 'white'/'black'.
 *
 * Any divergence from the Python result is called out explicitly rather than
 * weakening an assertion to force a pass.
 */

import { describe, it, expect } from 'vitest';
import { assemble, guessOrientation, guessSideToMove, inferMove } from '../vision/position';
import type { SquareLabel, AssembledPosition } from '../vision/position';
import { posFromFen, playUci, fenOf, boardFenOf, pieceCodeAt } from '../core/chess';
import type { SquareName } from '../core/chess';
import { squareName } from '../vision/types';
import type { Orientation } from '../vision/types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const START_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

// TS port of tests/position_grids.py board_to_grid: render a position into an
// 8x8 geometric grid (grid[row][col]; row 0 = board top, col 0 = left).
function boardToGrid(
  fen: string,
  orientation: Orientation = 'white_bottom',
  confidence = 1.0,
): SquareLabel[][] {
  const pos = posFromFen(fen);
  const grid: SquareLabel[][] = [];
  for (let row = 0; row < 8; row++) {
    const gridRow: SquareLabel[] = [];
    for (let col = 0; col < 8; col++) {
      const name = squareName(col, row, orientation) as SquareName;
      gridRow.push({ piece: pieceCodeAt(pos, name), confidence });
    }
    grid.push(gridRow);
  }
  return grid;
}

function emptyGrid(): SquareLabel[][] {
  return Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => ({ piece: null, confidence: 1.0 }) as SquareLabel),
  );
}

// placement-only FEN after playing `uci` (mirrors `_after(board, uci).board_fen()`).
function afterPlacement(fen: string, uci: string): string {
  return boardFenOf(playUci(posFromFen(fen), uci));
}
// full FEN after playing `uci` (mirrors `_after(board, uci)`).
function afterFen(fen: string, uci: string): string {
  return fenOf(playUci(posFromFen(fen), uci));
}

describe('SquareLabel', () => {
  it('holds piece code and confidence', () => {
    const label: SquareLabel = { piece: 'wQ', confidence: 0.9 };
    expect(label.piece).toBe('wQ');
    expect(label.confidence).toBe(0.9);
    const empty: SquareLabel = { piece: null, confidence: 0.1 };
    expect(empty.piece).toBeNull();
  });
});

describe('AssembledPosition', () => {
  it('holds the expected fields', () => {
    const ap: AssembledPosition = {
      fen: '8/8/8/8/8/8/8/8 w - - 0 1',
      isLegal: false,
      status: 'empty',
      lowConfidence: [],
      move: null,
      orientation: 'white_bottom',
      sideToMove: 'white',
    };
    expect(ap.isLegal).toBe(false);
    expect(ap.orientation).toBe('white_bottom');
  });
});

describe('boardToGrid helper', () => {
  it('roundtrips piece positions', () => {
    const grid = boardToGrid(START_FEN, 'white_bottom');
    expect(grid.length).toBe(8);
    expect(grid[0].length).toBe(8);
    // geometric top-left (row0,col0) is a8 under white_bottom -> black rook
    expect(grid[0][0].piece).toBe('bR');
    // geometric bottom-right (row7,col7) is h1 -> white rook
    expect(grid[7][7].piece).toBe('wR');
    // an empty middle square
    expect(grid[4][4].piece).toBeNull();
  });
});

describe('assemble', () => {
  it('roundtrips the start position', () => {
    const ap = assemble(boardToGrid(START_FEN), { orientation: 'white_bottom', white: true });
    expect(ap.isLegal).toBe(true);
    expect(ap.status).toBe('valid');
    expect(ap.fen.split(' ')[0]).toBe(START_PLACEMENT);
  });

  it('roundtrips a midgame position', () => {
    const placement = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R';
    const fen = `${placement} w KQkq - 2 3`;
    const ap = assemble(boardToGrid(fen), { orientation: 'white_bottom', white: true });
    expect(ap.fen.split(' ')[0]).toBe(placement);
  });

  it('orientation maps the geometric origin', () => {
    // white rook at geometric top-left (row0,col0); kings placed so BOTH
    // orientations yield a legal position (no checks, kings not adjacent).
    const grid = emptyGrid();
    grid[0][0] = { piece: 'wR', confidence: 1.0 };
    grid[7][7] = { piece: 'wK', confidence: 1.0 };
    grid[3][3] = { piece: 'bK', confidence: 1.0 };
    const wb = assemble(grid, { orientation: 'white_bottom', white: true });
    const bb = assemble(grid, { orientation: 'black_bottom', white: true });
    // top-left geometric square is a8 under white_bottom, h1 under black_bottom
    expect(pieceCodeAt(posFromFen(wb.fen), 'a8')).toBe('wR');
    expect(pieceCodeAt(posFromFen(bb.fen), 'h1')).toBe('wR');
  });

  it('flags an illegal two-white-kings placement', () => {
    const grid = emptyGrid();
    grid[7][0] = { piece: 'wK', confidence: 1.0 };
    grid[7][7] = { piece: 'wK', confidence: 1.0 };
    grid[0][0] = { piece: 'bK', confidence: 1.0 };
    const ap = assemble(grid, { orientation: 'white_bottom', white: true });
    expect(ap.isLegal).toBe(false);
    expect(ap.move).toBeNull();
    expect(ap.status).toContain('king');
    expect(ap.fen).toBeTruthy(); // best-guess FEN still produced
  });

  it('flags low-confidence squares', () => {
    const grid = boardToGrid(START_FEN, 'white_bottom', 0.9);
    // knock two squares below the default 0.5 threshold: a piece (a8) and an empty (e4)
    grid[0][0] = { piece: grid[0][0].piece, confidence: 0.2 }; // a8
    grid[4][4] = { piece: null, confidence: 0.1 }; // e4, low-confidence empty
    const ap = assemble(grid, { orientation: 'white_bottom', white: true });
    expect(new Set(ap.lowConfidence)).toEqual(new Set(['a8', 'e4']));
  });

  it('reports no low-confidence squares when all above threshold', () => {
    const ap = assemble(boardToGrid(START_FEN, 'white_bottom', 0.95), {
      orientation: 'white_bottom',
      white: true,
    });
    expect(ap.lowConfidence).toEqual([]);
  });

  it('grants full castling for the start position', () => {
    const ap = assemble(boardToGrid(START_FEN), { orientation: 'white_bottom', white: true });
    expect(ap.fen.split(' ')[2]).toBe('KQkq');
  });

  it('withholds castling when a rook is off its home square', () => {
    // start position minus the white queen-side rook (a1)
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR w - - 0 1';
    const ap = assemble(boardToGrid(fen), { orientation: 'white_bottom', white: true });
    const castling = ap.fen.split(' ')[2];
    expect(castling).not.toContain('Q'); // queen-side white right withheld
    expect(castling).toContain('K');
    expect(castling).toContain('k');
    expect(castling).toContain('q');
  });

  it('grants no castling when kings are off home', () => {
    const grid = emptyGrid();
    grid[7][4] = { piece: 'wK', confidence: 1.0 }; // e1
    grid[7][0] = { piece: 'wR', confidence: 1.0 }; // a1
    grid[7][7] = { piece: 'wR', confidence: 1.0 }; // h1
    grid[3][3] = { piece: 'bK', confidence: 1.0 }; // d5 (off home)
    const ap = assemble(grid, { orientation: 'white_bottom', white: true });
    // white may castle (king+rooks home); black cannot (king off home)
    const castling = ap.fen.split(' ')[2];
    expect(castling).toContain('K');
    expect(castling).toContain('Q');
    expect(castling).not.toContain('k');
    expect(castling).not.toContain('q');
  });

  it('reports the inferred move', () => {
    const ap = assemble(boardToGrid(afterFen(START_FEN, 'e2e4')), {
      orientation: 'white_bottom',
      white: false,
      prevFen: START_FEN,
    });
    expect(ap.move).toBe('e2e4');
  });

  it('sets the ep square on a double pawn push', () => {
    const ap = assemble(boardToGrid(afterFen(START_FEN, 'e2e4')), {
      orientation: 'white_bottom',
      white: false,
      prevFen: START_FEN,
    });
    expect(ap.fen.split(' ')[3]).toBe('e3'); // ep target behind the pushed pawn
  });

  it('sets no ep square on a quiet move', () => {
    const ap = assemble(boardToGrid(afterFen(START_FEN, 'g1f3')), {
      orientation: 'white_bottom',
      white: false,
      prevFen: START_FEN,
    });
    expect(ap.fen.split(' ')[3]).toBe('-');
    expect(ap.move).toBe('g1f3');
  });

  it('reports no move without a prevFen', () => {
    const ap = assemble(boardToGrid(START_FEN), { orientation: 'white_bottom', white: true });
    expect(ap.move).toBeNull();
  });
});

describe('inferMove', () => {
  it('detects a quiet move', () => {
    expect(inferMove(START_FEN, afterPlacement(START_FEN, 'e2e4'))).toBe('e2e4');
  });

  it('detects a capture', () => {
    const prev = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
    expect(inferMove(prev, afterPlacement(prev, 'e4d5'))).toBe('e4d5');
  });

  it('detects kingside castling', () => {
    const prev = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    expect(inferMove(prev, afterPlacement(prev, 'e1g1'))).toBe('e1g1');
  });

  it('detects queenside castling', () => {
    const prev = '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1';
    expect(inferMove(prev, afterPlacement(prev, 'e1c1'))).toBe('e1c1');
  });

  it('detects promotion (queen vs knight)', () => {
    const prev = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    expect(inferMove(prev, afterPlacement(prev, 'a7a8q'))).toBe('a7a8q');
    expect(inferMove(prev, afterPlacement(prev, 'a7a8n'))).toBe('a7a8n');
  });

  it('detects en passant', () => {
    const prev = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    expect(inferMove(prev, afterPlacement(prev, 'e5d6'))).toBe('e5d6');
  });

  it('returns null for a multi-move jump', () => {
    const two = boardFenOf(playUci(playUci(posFromFen(START_FEN), 'e2e4'), 'e7e5'));
    expect(inferMove(START_FEN, two)).toBeNull();
  });

  it('returns null for an unreachable placement', () => {
    expect(inferMove(START_FEN, '4k3/8/8/8/8/8/8/4K3')).toBeNull();
  });
});

describe('guessOrientation', () => {
  it('detects white_bottom', () => {
    expect(guessOrientation(boardToGrid(START_FEN, 'white_bottom'))).toBe('white_bottom');
  });

  it('detects black_bottom', () => {
    expect(guessOrientation(boardToGrid(START_FEN, 'black_bottom'))).toBe('black_bottom');
  });

  it('returns null when ambiguous (too few pieces)', () => {
    const grid = emptyGrid();
    grid[7][4] = { piece: 'wK', confidence: 1.0 };
    grid[0][4] = { piece: 'bK', confidence: 1.0 };
    expect(guessOrientation(grid)).toBeNull();
  });
});

describe('guessSideToMove', () => {
  it('uses the inferred move (opposite of prev turn)', () => {
    expect(guessSideToMove(START_FEN, { prevFen: START_FEN, move: 'e2e4' })).toBe('black');
  });

  it('uses the highlighted destination square', () => {
    // white pawn sits on the highlighted destination e4 -> white just moved -> black to move
    const fen = '4k3/8/8/8/4P3/8/8/4K3 b - - 0 1';
    expect(guessSideToMove(fen, { highlightSquares: ['e2', 'e4'] })).toBe('black');
  });

  it('declines (defaults white) when both highlighted squares are occupied', () => {
    // Not a completed normal move -> ambiguous -> keep the default rather than guess wrong.
    const fen = '4k3/8/8/8/4P3/8/4P3/4K3 w - - 0 1'; // pawns on e4 AND e2
    expect(guessSideToMove(fen, { highlightSquares: ['e2', 'e4'] })).toBe('white');
  });

  it('declines (defaults white) when neither highlighted square is occupied', () => {
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1'; // e2 and e4 both empty
    expect(guessSideToMove(fen, { highlightSquares: ['e2', 'e4'] })).toBe('white');
  });

  it('defaults to white', () => {
    expect(guessSideToMove(START_FEN, {})).toBe('white');
  });

  it('prefers the inferred move over a conflicting highlight (precedence)', () => {
    // prevFen+move say White just moved -> Black to move. The (stale) highlight sits on
    // an occupied BLACK piece, which ALONE would say White to move. The move path (checked
    // first) must win, so the highlight is never consulted.
    const afterFen = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2';
    expect(guessSideToMove(afterFen, {
      prevFen: START_FEN, move: 'e2e4',
      highlightSquares: ['e7', 'e5'], // black pawn on e5 -> highlight-alone would give 'white'
    })).toBe('black');
  });
});
