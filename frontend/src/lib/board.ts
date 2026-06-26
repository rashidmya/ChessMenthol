import { Chess } from 'chess.js';

/** Convert a chessground (orig, dest) move to a UCI string. Pure join; the
 *  caller passes a promotion piece (e.g. 'q') when a pawn reaches the back rank. */
export function moveToUci(orig: string, dest: string, promotion?: string): string {
  return promotion !== undefined ? `${orig}${dest}${promotion}` : `${orig}${dest}`;
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
