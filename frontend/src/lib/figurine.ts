const GLYPH: Record<string, string> = {
  K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞',
};

/** Figurine notation: replace uppercase piece letters (K/Q/R/B/N) with the filled
 *  (black) Unicode chess glyphs. SAN uses lowercase for files (a-h) and 'O' for
 *  castling, so a global replace is safe — pawn moves and castling pass through
 *  unchanged. Promotion suffixes (e.g. "=Q") convert too. */
export function toFigurine(san: string): string {
  return san.replace(/[KQRBN]/g, (ch) => GLYPH[ch]);
}
