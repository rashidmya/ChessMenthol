import { Chess } from 'chess.js';

/** Convert a chessground (orig, dest) move to a UCI string. Pure join; the
 *  caller passes a promotion piece (e.g. 'q') when a pawn reaches the back rank. */
export function moveToUci(orig: string, dest: string, promotion?: string): string {
  return promotion !== undefined ? `${orig}${dest}${promotion}` : `${orig}${dest}`;
}

/** The promotion piece for a move, or undefined when it is not a promotion.
 *  Only a PAWN reaching the last rank promotes — a non-pawn landing on rank 1/8
 *  (e.g. Bxf1) must NOT get a suffix, or the engine rejects it as illegal.
 *  `fen` is the position BEFORE the move; auto-queens for now. Returns undefined
 *  for an unparseable FEN rather than guessing. */
export function promotionPiece(fen: string, orig: string, dest: string): 'q' | undefined {
  const lastRank = dest[1] === '1' || dest[1] === '8';
  if (!lastRank) return undefined;
  let game: Chess;
  try {
    game = new Chess(fen);
  } catch {
    return undefined;
  }
  const piece = game.get(orig as any);
  return piece && piece.type === 'p' ? 'q' : undefined;
}

/** Side to move from a FEN's turn field ('w'/'b'); defaults to white if absent. */
export function turnColor(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** Legal-move map { fromSquare: [toSquare, ...] } for chessground's
 *  `movable.dests`, derived from the FEN. Only the side to move has entries, so
 *  the board permits exactly the legal moves and snaps everything else back.
 *  Returns an empty map for an unparseable FEN (e.g. a transient edit position). */
export function legalDests(fen: string): Map<string, string[]> {
  const dests = new Map<string, string[]>();
  let game: Chess;
  try {
    game = new Chess(fen);
  } catch {
    return dests;
  }
  for (const move of game.moves({ verbose: true })) {
    const tos = dests.get(move.from);
    if (tos) {
      if (!tos.includes(move.to)) tos.push(move.to);
    } else {
      dests.set(move.from, [move.to]);
    }
  }
  return dests;
}
