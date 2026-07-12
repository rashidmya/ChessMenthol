import { posFromFen, legalDestsCg, legalMovesUci } from '../core/chess';

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
  try {
    const pos = posFromFen(fen);
    return legalMovesUci(pos).includes(`${orig}${dest}q`) ? 'q' : undefined;
  } catch {
    return undefined;
  }
}

/** The UCI of the move that led to the current position, or null at the start.
 *  `currentPly` is the cursor into `moveList` (1-based: ply N is moveList[N-1]);
 *  0 means "before any move" — used to clear the last-move highlight on
 *  reset/New and when navigated back to the initial position. Out-of-range
 *  cursors yield null rather than throwing. */
export function currentLastMoveUci(moveList: { uci: string }[], currentPly: number): string | null {
  if (currentPly <= 0 || currentPly > moveList.length) return null;
  return moveList[currentPly - 1]?.uci ?? null;
}

/** A UCI move as chessground's [orig, dest] square keys, or undefined when there
 *  is no last move. The promotion suffix is dropped (chessground highlights the
 *  two squares, not the piece). undefined (not omission) is what clears
 *  chessground's lastMove — see Board.svelte. */
export function lastMoveSquares(uci: string | null): [string, string] | undefined {
  if (!uci) return undefined;
  return [uci.slice(0, 2), uci.slice(2, 4)];
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
  try {
    return legalDestsCg(posFromFen(fen));
  } catch {
    return new Map<string, string[]>();
  }
}
