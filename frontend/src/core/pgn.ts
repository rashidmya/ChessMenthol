/**
 * core/pgn.ts — the SECOND sanctioned chessops-facing wrapper (alongside
 * core/chess.ts). Wraps chessops/pgn + chessops/san + chessops/variant so the
 * PGN API never leaks into the rest of the app.
 */
import { makePgn, defaultGame, type PgnNodeData } from 'chessops/pgn';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface ParsedGame {
  baseFen: string;
  moves: { uci: string; san: string }[];
  headers: Map<string, string>;
}

/** Headers-only PGN describing a setup position (for the editor's PGN box). */
export function makePositionPgn(fen: string): string {
  const game = defaultGame<PgnNodeData>();
  if (fen.trim() !== START_FEN) {
    game.headers.set('SetUp', '1');
    game.headers.set('FEN', fen.trim());
  }
  return makePgn(game);
}

/** Cheap sniff so the Home box can route paste text to PGN-import vs FEN. */
export function looksLikePgn(text: string): boolean {
  const t = text.trim();
  if (/\[[A-Za-z0-9]+\s+"/.test(t)) return true;      // a [Tag "..."] header line
  if (/\b\d+\.\s*[A-Za-z]/.test(t)) return true;       // a "1. e4" style movetext token
  return false;
}
