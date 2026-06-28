/**
 * core/chess.ts — thin wrapper layer over chessops.
 *
 * This is the ONLY file in the codebase that imports from chessops directly.
 * All other modules (board.ts, classify.ts, serialize.ts, orchestrator.ts)
 * must go through these wrappers so that the chessops API never leaks outward.
 *
 * `attackedBy` accepts either a numeric Square index (0–63, chessops internal)
 * or an algebraic SquareName string (e.g. 'e4'). The algebraic form is most
 * ergonomic for classify.ts callers who extract squares from UCI strings.
 */

import { parseFen, makeFen, makeBoardFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeSan, makeSanVariation } from 'chessops/san';
import { parseUci, makeUci, makeSquare, parseSquare, squareRank } from 'chessops/util';
import type { Color, Move, Piece, Role, Square, SquareName } from 'chessops/types';
import { Board } from 'chessops/board';
import { defaultSetup } from 'chessops/setup';
import { SquareSet } from 'chessops/squareSet';

// Re-export Chess so callers can type positions without importing chessops directly.
export type { Chess };
export type { Color, Role, Square, SquareName };

// Promotion roles, in the order chessops/python-chess enumerate them.
// Module-scoped so `legalMovesUci` does not re-allocate it on every call.
const PROMOTION_ROLES: Role[] = ['queen', 'rook', 'bishop', 'knight'];

// ─── posFromFen ──────────────────────────────────────────────────────────────

/**
 * Parse a FEN string into a Chess position.
 *
 * Throws (via chessops `.unwrap()`) on any FEN syntax error or illegal setup.
 * Mirrors Python's `chess.Board(fen)` with its validity check.
 */
export function posFromFen(fen: string): Chess {
  const setup = parseFen(fen).unwrap();
  return Chess.fromSetup(setup).unwrap();
}

// ─── fenOf ───────────────────────────────────────────────────────────────────

/**
 * Serialise a position back to a FEN string.
 */
export function fenOf(pos: Chess): string {
  return makeFen(pos.toSetup());
}

// ─── legalDestsCg ────────────────────────────────────────────────────────────

/**
 * Return the legal-move destination map in chessground format:
 * `Map<SquareName, SquareName[]>` (aliased as `Map<Key, Key[]>` by chessground).
 * Pass directly to `Chessground({ movable: { dests } })`.
 */
export function legalDestsCg(pos: Chess): Map<SquareName, SquareName[]> {
  return chessgroundDests(pos);
}

// ─── legalMovesUci ───────────────────────────────────────────────────────────

/**
 * Return all legal moves for the position in UCI notation.
 *
 * Pawn promotions expand to four moves each (q/r/b/n), e.g. `'e7e8q'`.
 */
export function legalMovesUci(pos: Chess): string[] {
  const moves: string[] = [];

  for (const [from, dests] of pos.allDests()) {
    const piece = pos.board.get(from);
    const isPawn = piece?.role === 'pawn';
    const isKing = piece?.role === 'king';

    for (const to of dests) {
      const destPiece = pos.board.get(to);
      // chessops encodes castling as king-captures-own-rook (e.g. e1h1), but the
      // board (chessgroundDests) and python-chess use the king-two-square form
      // (e1g1) — and the UI sends THAT. Emit BOTH so the orchestrator accepts
      // whichever destination the board offered (chessgroundDests offers the king
      // both the rook square and the g/c file). Standard-chess only (king on e-file).
      if (isKing && destPiece?.role === 'rook' && destPiece.color === piece!.color) {
        const kingFile = to > from ? 6 : 2; // g-file kingside / c-file queenside
        moves.push(makeUci({ from, to: kingFile + squareRank(from) * 8 })); // e1g1 / e1c1
        moves.push(makeUci({ from, to })); // e1h1 / e1a1 (king-takes-rook form)
        continue;
      }
      const onBackrank = squareRank(to) === 0 || squareRank(to) === 7;
      if (isPawn && onBackrank) {
        for (const promotion of PROMOTION_ROLES) {
          moves.push(makeUci({ from, to, promotion }));
        }
      } else {
        moves.push(makeUci({ from, to }));
      }
    }
  }

  return moves;
}

// ─── playUci ─────────────────────────────────────────────────────────────────

/**
 * Play a UCI move on `pos`, returning the resulting position.
 *
 * Does NOT mutate the input. Throws on syntactically invalid or illegal moves.
 */
export function playUci(pos: Chess, uci: string): Chess {
  const move: Move | undefined = parseUci(uci);
  if (!move) throw new Error(`Invalid UCI notation: "${uci}"`);
  if (!pos.isLegal(move)) throw new Error(`Illegal move: "${uci}"`);
  const next = pos.clone();
  next.play(move);
  return next;
}

// ─── sanOf ───────────────────────────────────────────────────────────────────

/**
 * Convert a single UCI move to SAN notation within the given position.
 * e.g. `sanOf(pos, 'e2e4') === 'e4'`.
 *
 * Throws on syntactically invalid OR illegal UCI. The legality guard matters:
 * chessops `makeSan` does not validate, so without it an illegal move like
 * 'e2e5' would silently produce a bogus SAN ('e5') instead of throwing.
 */
export function sanOf(pos: Chess, uci: string): string {
  const move: Move | undefined = parseUci(uci);
  if (!move) throw new Error(`Invalid UCI notation: "${uci}"`);
  if (!pos.isLegal(move)) throw new Error(`Illegal move: "${uci}"`);
  return makeSan(pos, move);
}

// ─── variationSan ────────────────────────────────────────────────────────────

/**
 * Convert a UCI move list to a numbered SAN variation string.
 * e.g. `variationSan(pos, ['e2e4','e7e5','g1f3']) === '1. e4 e5 2. Nf3'`.
 *
 * chessops `makeSanVariation` clones the position internally, so `pos` is
 * not mutated.
 */
export function variationSan(pos: Chess, uciList: string[]): string {
  if (uciList.length === 0) return '';
  const moves: Move[] = uciList.map((uci) => {
    const move = parseUci(uci);
    if (!move) throw new Error(`Invalid UCI notation in variation: "${uci}"`);
    return move;
  });
  const raw = makeSanVariation(pos, moves);
  // chessops emits "1... e5" (space after ...) but python-chess emits "1...e5".
  // Normalise to python-chess format so parity tests hold.
  return raw.replace(/(\d+\.\.\.) /g, '$1');
}

// ─── outcomeOf ───────────────────────────────────────────────────────────────

/**
 * If the game is over, return `{ result, reason }`.  Otherwise return `null`.
 *
 * `result` is always from White's perspective: `'1-0'` white wins, `'0-1'`
 * black wins, `'1/2-1/2'` draw.
 *
 * `reason` mirrors python-chess strings: `'checkmate'`, `'stalemate'`,
 * `'insufficient material'`. Falls back to `'unknown'` for other endings
 * (e.g. 75-move rule in variants) that chessops may not expose individually.
 */
export function outcomeOf(
  pos: Chess,
): { result: '1-0' | '0-1' | '1/2-1/2'; reason: string } | null {
  if (!pos.isEnd()) return null;

  const outcome = pos.outcome();
  if (!outcome) return null; // isEnd() was true but no outcome — shouldn't happen

  let reason: string;
  if (pos.isCheckmate()) reason = 'checkmate';
  else if (pos.isStalemate()) reason = 'stalemate';
  else if (pos.isInsufficientMaterial()) reason = 'insufficient material';
  else reason = 'unknown';

  let result: '1-0' | '0-1' | '1/2-1/2';
  if (outcome.winner === 'white') result = '1-0';
  else if (outcome.winner === 'black') result = '0-1';
  else result = '1/2-1/2';

  return { result, reason };
}

// ─── attackedBy ──────────────────────────────────────────────────────────────

/**
 * Return `true` if the given `square` is attacked by any piece of `color`.
 *
 * `square` may be:
 *   - a chessops `Square` (numeric index 0–63), or
 *   - an algebraic SquareName string (e.g. `'e4'`).
 *
 * The algebraic form is most ergonomic for classify.ts callers who derive
 * squares from UCI move strings (e.g. "is the destination square of this
 * capture defended by the opponent?").
 *
 * Internally delegates to `Position.kingAttackers(sq, color, occupied)`,
 * which — despite the name — is a general "pieces of `color` that attack `sq`"
 * computation used throughout the chessops engine.
 */
export function attackedBy(pos: Chess, square: Square | SquareName, color: Color): boolean {
  const sq: Square | undefined =
    typeof square === 'number' ? square : parseSquare(square);
  if (sq === undefined) throw new Error(`Invalid square: "${square}"`);
  return pos.kingAttackers(sq, color, pos.board.occupied).nonEmpty();
}

// ─── roleAt ──────────────────────────────────────────────────────────────────

/**
 * Return the `Role` (piece type) of the piece on `square`, or `undefined` if
 * the square is empty.
 *
 * `square` may be a chessops `Square` (numeric 0–63) or a `SquareName` string.
 * Throws on an unrecognised square string.
 *
 * Intended use: classify.ts needs to know what piece stands on a destination
 * square before and after a move (to compute material gain/risk in `isSacrifice`).
 * Keeping this inside the wrapper ensures classify.ts never imports chessops.
 */
export function roleAt(pos: Chess, square: Square | SquareName): Role | undefined {
  const sq: Square | undefined =
    typeof square === 'number' ? square : parseSquare(square);
  if (sq === undefined) throw new Error(`Invalid square: "${square}"`);
  return pos.board.get(sq)?.role;
}

// ─── makeSquare re-export ─────────────────────────────────────────────────────

/**
 * Convert a numeric Square index (0–63) to its algebraic name.
 * Convenience export so callers never need to import from chessops/util.
 */
export { makeSquare };

// ─── boardFenOf / assembleFromGrid ────────────────────────────────────────────

/** Placement-only FEN field (python-chess board_fen equivalent). */
export function boardFenOf(pos: Chess): string {
  return makeBoardFen(pos.board);
}

export interface AssembleResult {
  fen: string;        // full FEN (en_passant shown if set)
  placement: string;  // first FEN field
  isLegal: boolean;
  status: string;     // 'valid' | 'invalid' (extended if callers need error detail)
  pos: Chess | null;  // present only when legal
}

// piece-code "wP"/"bK"/null -> chessops Piece
const ROLE_OF: Record<string, Role> = {
  P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king',
};

function pieceFromCode(code: string | null): Piece | null {
  if (!code) return null;
  return { color: code[0] === 'w' ? 'white' : 'black', role: ROLE_OF[code[1]] };
}

// Geometric (col, row) where row 0 = rank 8 (top of board when white is at bottom).
function squareNameGeom(col: number, row: number): SquareName {
  return `${String.fromCharCode(97 + col)}${8 - row}` as SquareName;
}

// Infer castling rights from kings+rooks on their home squares.
function inferCastling(board: Board): SquareSet {
  let rights = SquareSet.empty();
  const at = (name: string) => board.get(parseSquare(name as SquareName)!);
  const wk = at('e1'), bk = at('e8');
  if (wk && wk.role === 'king' && wk.color === 'white') {
    const h1 = at('h1'), a1 = at('a1');
    if (h1 && h1.role === 'rook' && h1.color === 'white') rights = rights.with(parseSquare('h1' as SquareName)!);
    if (a1 && a1.role === 'rook' && a1.color === 'white') rights = rights.with(parseSquare('a1' as SquareName)!);
  }
  if (bk && bk.role === 'king' && bk.color === 'black') {
    const h8 = at('h8'), a8 = at('a8');
    if (h8 && h8.role === 'rook' && h8.color === 'black') rights = rights.with(parseSquare('h8' as SquareName)!);
    if (a8 && a8.role === 'rook' && a8.color === 'black') rights = rights.with(parseSquare('a8' as SquareName)!);
  }
  return rights;
}

/**
 * Build a position from a geometric grid (grid[row][col], row0 = a8..h8) with the
 * given side to move. Castling rights are inferred from kings+rooks on home squares
 * (mirrors position.py `_infer_castling_rights`); ep is left unset here (the caller
 * sets it for an inferred double pawn push). Reports legality without throwing.
 */
export function assembleFromGrid(
  grid: (string | null)[][],
  opts: { white: boolean },
): AssembleResult {
  const board = Board.empty();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = pieceFromCode(grid[row][col]);
      if (piece) board.set(parseSquare(squareNameGeom(col, row))!, piece);
    }
  }
  const setup = { ...defaultSetup(), board, turn: (opts.white ? 'white' : 'black') as Color };
  setup.castlingRights = inferCastling(board);
  const result = Chess.fromSetup(setup);
  const placement = makeBoardFen(board);
  if (result.isOk) {
    const pos = result.unwrap();
    return { fen: makeFen(pos.toSetup()), placement, isLegal: true, status: 'valid', pos };
  }
  // Illegal: synthesize a FEN string for display/compare from the raw setup.
  const fen = `${placement} ${opts.white ? 'w' : 'b'} - - 0 1`;
  return { fen, placement, isLegal: false, status: 'invalid', pos: null };
}
