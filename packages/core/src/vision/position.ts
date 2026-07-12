/**
 * vision/position.ts — Assembles classified squares into a chess position,
 * plus orientation / side-to-move / last-move inference.
 * Built entirely on the `core/chess.ts` wrapper layer — never imports chessops directly.
 *
 * `AssembledPosition` is PLAIN DATA (no chessops object held) so it can be
 * structured-cloned across a Web Worker boundary. The tracker keeps `prevFen`
 * as a string and passes it into `assemble`.
 */

import {
  assembleFromGrid,
  boardFenOf,
  legalMovesUci,
  playUci,
  posFromFen,
  roleAt,
  pieceCodeAt,
} from '../core/chess';
import type { SquareName } from '../core/chess';
import { squareName } from './types';
import type { Orientation } from './types';

/** One classified square. `piece=null` means an empty square; otherwise a
 * 2-char code 'wP'..'bK' (colour letter + uppercase piece letter). */
export interface SquareLabel {
  piece: string | null;
  confidence: number;
}

/**
 * Plain-data snapshot of an assembled board position — no chessops objects.
 * Must remain structured-cloneable across a Web Worker boundary; never add a
 * Chess/Board/chessops type as a field.
 */
export interface AssembledPosition {
  fen: string;
  isLegal: boolean;
  /** 'valid' when legal, else the chessops validation reason (e.g. 'kings').
   * Passes through `AssembleResult.status` from core/chess.ts. */
  status: string;
  lowConfidence: string[];
  /** Inferred UCI move vs `prevFen`, or null. */
  move: string | null;
  orientation: Orientation;
  sideToMove: 'white' | 'black';
}

// ─── inferMove ─────────────────────────────────────────────────────────────────

/**
 * Return the single legal UCI move from `prevFen` whose resulting piece placement
 * matches `newPlacement` (placement-only, ignoring side-to-move / castling / ep —
 * which a screenshot cannot observe), or null if zero or multiple distinct moves
 * match. Mirrors python-chess's `infer_move`: correct-by-construction for
 * castling, en-passant and promotion since each yields a distinct placement.
 */
export function inferMove(prevFen: string, newPlacement: string): string | null {
  const prev = posFromFen(prevFen);
  const matches: string[] = [];
  for (const uci of legalMovesUci(prev)) {
    if (boardFenOf(playUci(prev, uci)) === newPlacement) matches.push(uci);
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  // Distinct legal moves always yield distinct placements (infer_move invariant),
  // so multiple matches only arise because legalMovesUci double-emits a single
  // castling move in two notations: king-two-square ('e1g1') AND king-takes-rook
  // ('e1h1'). python-chess enumerates castling once, as 'e1g1', so return that
  // form — the one whose destination square is NOT the (friendly) rook. If we
  // ever see matches that are not this castling pair, treat as ambiguous -> null.
  const kingTwoSquare = matches.filter(
    (uci) => roleAt(prev, uci.slice(2, 4) as SquareName) !== 'rook',
  );
  return kingTwoSquare.length === 1 ? kingTwoSquare[0] : null;
}

// ─── withEpSquare ────────────────────────────────────────────────────────────

/**
 * Mirror of python-chess's `_maybe_set_ep_square` + `board.fen(en_passant="fen")`:
 * if the inferred `uci` is a double pawn push (the moved piece in `prevFen` is a
 * pawn and the rank changes by 2), rewrite the FEN's ep field (4th token) to the
 * square the pawn skipped over (e.g. e2e4 -> e3). Otherwise return `fen` unchanged.
 */
function withEpSquare(fen: string, prevFen: string, uci: string): string {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  if (roleAt(posFromFen(prevFen), from as SquareName) !== 'pawn') return fen;
  const fromRank = Number(from[1]);
  const toRank = Number(to[1]);
  if (Math.abs(fromRank - toRank) !== 2) return fen;
  const ep = `${from[0]}${(fromRank + toRank) / 2}`;
  const fields = fen.split(' ');
  fields[3] = ep;
  return fields.join(' ');
}

// ─── assemble ──────────────────────────────────────────────────────────────────

/**
 * Assemble `grid` into an `AssembledPosition`. `opts.white` is the side to move
 * (call `guessSideToMove` first if not known) — assemble does not infer it.
 * `opts.prevFen` enables move inference + ep-square reconstruction; omit if there
 * is no previous frame. Returns plain data (no chessops objects; worker-cloneable).
 */
export function assemble(
  grid: SquareLabel[][],
  opts: {
    orientation: Orientation;
    white: boolean;
    prevFen?: string | null;
    confidenceThreshold?: number;
  },
): AssembledPosition {
  const { orientation, white } = opts;
  const prevFen = opts.prevFen ?? null;
  const confidenceThreshold = opts.confidenceThreshold ?? 0.5;

  // Project the (possibly black_bottom) grid into the white_bottom geometric
  // frame that assembleFromGrid expects: place each label at the white_bottom
  // cell of its algebraic square (squareName(col,row,orientation)). This mirrors
  // the Python original placing pieces via parse_square(square_name(col,row,orientation)).
  // assembleFromGrid's own squareNameGeom treats row 0 as rank 8 (white_bottom
  // only), so a black_bottom grid must be remapped here — effectively a 180°
  // rotation — before handing it over.
  const codes: (string | null)[][] = Array.from({ length: 8 }, () =>
    Array<string | null>(8).fill(null),
  );
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = grid[row][col].piece;
      if (piece === null) continue;
      const name = squareName(col, row, orientation); // algebraic, e.g. 'e4'
      const wbCol = name.charCodeAt(0) - 97; // file 0..7
      const wbRow = 8 - Number(name[1]); // rank 1..8 -> row 7..0
      codes[wbRow][wbCol] = piece;
    }
  }
  const result = assembleFromGrid(codes, { white });
  const isLegal = result.isLegal;

  const move =
    prevFen !== null && isLegal ? inferMove(prevFen, result.placement) : null;

  // For an inferred double pawn push, surface the ep target square in the FEN
  // (python-chess always shows a set ep square via en_passant="fen").
  const fen = move !== null ? withEpSquare(result.fen, prevFen as string, move) : result.fen;

  const lowConfidence: string[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (grid[row][col].confidence < confidenceThreshold) {
        lowConfidence.push(squareName(col, row, orientation));
      }
    }
  }

  return {
    fen,
    isLegal,
    status: result.status, // 'valid' when legal, else the validation reason
    lowConfidence,
    move,
    orientation,
    sideToMove: white ? 'white' : 'black',
  };
}

// ─── guessOrientation ────────────────────────────────────────────────────────

/**
 * Best-effort orientation from piece layout; null when ambiguous. Compares the
 * two outermost geometric rows on each edge: white pieces concentrated at the
 * bottom (and black at the top) implies white_bottom.
 */
export function guessOrientation(grid: SquareLabel[][]): Orientation | null {
  const balance = (rows: number[]): [number, number] => {
    let white = 0;
    let black = 0;
    for (const r of rows) {
      for (const label of grid[r]) {
        if (label.piece !== null) {
          if (label.piece[0] === 'w') white += 1;
          else black += 1;
        }
      }
    }
    return [white, black];
  };

  const [bottomWhite, bottomBlack] = balance([6, 7]);
  const [topWhite, topBlack] = balance([0, 1]);
  if (bottomWhite + bottomBlack + topWhite + topBlack < 6) return null;
  if (bottomWhite > bottomBlack && topBlack > topWhite) return 'white_bottom';
  if (topWhite > topBlack && bottomBlack > bottomWhite) return 'black_bottom';
  return null;
}

// ─── guessSideToMove ─────────────────────────────────────────────────────────

/**
 * Best-effort side to move. (The caller owns any user override.)
 *
 *  - `prevFen` + `move` present  -> opposite of prev's side to move.
 *  - else `highlightSquares`     -> for a genuine last move the origin square is
 *    empty post-move, so exactly one highlighted square is occupied (the
 *    destination); the piece there is the mover, so the other side is to move.
 *  - else                        -> 'white'.
 */
export function guessSideToMove(
  fen: string,
  opts: { prevFen?: string | null; move?: string | null; highlightSquares?: string[] },
): 'white' | 'black' {
  const prevFen = opts.prevFen ?? null;
  const move = opts.move ?? null;
  if (prevFen !== null && move !== null) {
    return posFromFen(prevFen).turn === 'white' ? 'black' : 'white';
  }
  if (opts.highlightSquares && opts.highlightSquares.length > 0) {
    // Trust the highlight only when the pair looks like a completed move: exactly one
    // square occupied (the destination) and the other empty (the origin). The piece on
    // the destination is the mover, so the other side is to move. Any other shape
    // (0 or >1 occupied) is ambiguous — decline and fall through to the default.
    const pos = posFromFen(fen);
    const occupied = opts.highlightSquares.filter(
      (name) => pieceCodeAt(pos, name as SquareName) !== null,
    );
    if (occupied.length === 1) {
      const code = pieceCodeAt(pos, occupied[0] as SquareName) as string;
      return code[0] === 'w' ? 'black' : 'white';
    }
  }
  return 'white';
}
