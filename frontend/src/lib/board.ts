/** Convert a chessground (orig, dest) move to a UCI string. Pure join; the
 *  caller passes a promotion piece (e.g. 'q') when a pawn reaches the back rank. */
export function moveToUci(orig: string, dest: string, promotion?: string): string {
  return promotion !== undefined ? `${orig}${dest}${promotion}` : `${orig}${dest}`;
}
