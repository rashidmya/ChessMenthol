/**
 * core/chess.ts — thin wrapper layer over chessops.
 *
 * This and `core/pgn.ts` are the only files in the codebase that import from
 * chessops directly. All other modules (board.ts, classify.ts, serialize.ts,
 * orchestrator.ts) must go through these wrappers so that the chessops API
 * never leaks outward.
 */

import { parseFen, makeFen, makeBoardFen } from 'chessops/fen';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeSan, makeSanVariation } from 'chessops/san';
import { parseUci, makeUci, parseSquare, squareRank, opposite } from 'chessops/util';
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

// ─── castleKingTarget ────────────────────────────────────────────────────────

/** King's destination square (king-two-square form: e1g1 / e1c1) for a castling
 *  move. `to` may be the rook square (chessops king-takes-rook, e1h1) or the
 *  king's two-square target — both sit on the king's own rank, so index order
 *  matches file order. */
export function castleKingTarget(from: Square, to: Square): Square {
  const kingFile = to > from ? 6 : 2; // g-file kingside / c-file queenside
  return kingFile + squareRank(from) * 8;
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
        moves.push(makeUci({ from, to: castleKingTarget(from, to) })); // e1g1 / e1c1
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

// ─── seeCapture ────────────────────────────────────────────────────────────

/**
 * Static Exchange Evaluation on `square`: the net material the **side to move**
 * wins by initiating the optimal capture sequence on the piece standing there,
 * assuming each side may stop capturing when it is no longer profitable.
 *
 * This is the swap-off algorithm (chessprogramming.org/Static_Exchange_Evaluation).
 * X-ray attackers (batteries) are revealed automatically: each iteration removes
 * the used attacker from the occupancy passed to `kingAttackers`, so a slider
 * behind it becomes a fresh attacker. Pins are ignored, as is conventional for
 * SEE — it measures material, not legality.
 *
 * Returns 0 when the square is empty or the side to move has no attacker of it.
 *
 * `value` maps each role to a centipawn value (callers pass their own scale so
 * this stays independent of classify.ts and free of a circular import).
 */
export function seeCapture(
  pos: Chess,
  square: Square | SquareName,
  value: Record<Role, number>,
): number {
  const sq: Square | undefined =
    typeof square === 'number' ? square : parseSquare(square);
  if (sq === undefined) throw new Error(`Invalid square: "${square}"`);

  const target = pos.board.get(sq);
  if (!target) return 0;

  let occ = pos.board.occupied;

  // Least-valuable attacker of `color` still present in `occ`. kingAttackers uses
  // `occ` for slider blocking (x-ray reveal); intersecting with `occ` drops the
  // attackers we have already spent from earlier plies of the exchange.
  const leastAttacker = (color: Color): { sq: Square; role: Role } | undefined => {
    const attackers = pos.kingAttackers(sq, color, occ).intersect(occ);
    let best: { sq: Square; role: Role } | undefined;
    let bestVal = Infinity;
    for (const s of attackers) {
      const role = pos.board.get(s)!.role;
      if (value[role] < bestVal) { bestVal = value[role]; best = { sq: s, role }; }
    }
    return best;
  };

  let side: Color = pos.turn;
  let attacker = leastAttacker(side);
  if (!attacker) return 0; // nothing can capture → not part of any exchange

  const gain: number[] = [value[target.role]]; // material on the square, captured first
  let d = 0;
  while (attacker) {
    d++;
    gain[d] = value[attacker.role] - gain[d - 1]; // speculative: I capture, you recapture
    if (Math.max(-gain[d - 1], gain[d]) < 0) break; // neither side gains by continuing
    occ = occ.without(attacker.sq);                 // spend this attacker (reveals x-rays)
    side = opposite(side);
    attacker = leastAttacker(side);
  }
  // Negamax the swap list back down: each side would stop capturing if continuing hurts.
  d--;
  while (d > 0) {
    gain[d - 1] = -Math.max(-gain[d - 1], gain[d]);
    d--;
  }
  return gain[0] === 0 ? 0 : gain[0]; // normalise the -0 that negamax can produce
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

// ─── pieceCodeAt ──────────────────────────────────────────────────────────────

// Role -> single-letter code; inverse of ROLE_OF below.
const CODE_OF_ROLE: Record<Role, string> = {
  pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K',
};

/**
 * Return the 2-char piece code ('wP'..'bK') of the piece on `square`, or `null`
 * if the square is empty.
 *
 * The inverse of `pieceFromCode` / `assembleFromGrid`'s input convention and the
 * colour-aware counterpart of `roleAt`. vision/position.ts needs a piece's COLOUR
 * (to derive side-to-move from a highlighted square) and must not import chessops,
 * so this accessor lives in the wrapper layer.
 */
export function pieceCodeAt(pos: Chess, square: Square | SquareName): string | null {
  const sq: Square | undefined =
    typeof square === 'number' ? square : parseSquare(square);
  if (sq === undefined) throw new Error(`Invalid square: "${square}"`);
  const piece = pos.board.get(sq);
  if (!piece) return null;
  return (piece.color === 'white' ? 'w' : 'b') + CODE_OF_ROLE[piece.role];
}

// ─── boardFenOf / assembleFromGrid ────────────────────────────────────────────

/** Placement-only FEN field (python-chess board_fen equivalent). */
export function boardFenOf(pos: Chess): string {
  return makeBoardFen(pos.board);
}

export interface AssembleResult {
  fen: string;        // full FEN (en_passant shown if set)
  placement: string;  // first FEN field
  isLegal: boolean;
  // 'valid' when legal, else a human-readable reason derived from the chessops
  // PositionError (e.g. 'kings', 'opposite check', 'pawns on backrank'). This
  // mirrors python-chess's status text closely enough that callers can substring-
  // match (position.py's tests assert "king" in status for a two-kings placement).
  status: string;
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
  // Illegal: synthesize a FEN string for display/compare from the raw setup, and
  // surface the validation reason (chessops 'ERR_KINGS' -> 'kings', etc.).
  const fen = `${placement} ${opts.white ? 'w' : 'b'} - - 0 1`;
  const reason = result.error.message.replace(/^ERR_/, '').toLowerCase().replace(/_/g, ' ');
  return { fen, placement, isLegal: false, status: reason || 'invalid', pos: null };
}
