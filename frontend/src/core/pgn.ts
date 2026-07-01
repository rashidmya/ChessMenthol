/**
 * core/pgn.ts — the SECOND sanctioned chessops-facing wrapper (alongside
 * core/chess.ts). Wraps chessops/pgn + chessops/san + chessops/fen +
 * chessops/util so the PGN API never leaks into the rest of the app.
 */
import { makePgn, defaultGame, parsePgn, startingPosition, type PgnNodeData } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeFen } from 'chessops/fen';
import { makeUci } from 'chessops/util';

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

/**
 * Parse the first game in a PGN string into a base FEN + a flat list of
 * mainline moves as `{ uci, san }` pairs. Throws on invalid start position,
 * unsupported variant, or illegal SAN.
 */
export function parseGame(text: string): ParsedGame {
  const games = parsePgn(text);
  if (games.length === 0) throw new Error('no game found in PGN');
  const game = games[0];

  const posResult = startingPosition(game.headers);
  if (posResult.isErr) throw new Error(`invalid start position: ${posResult.error.message}`);
  const pos = posResult.unwrap();
  if (pos.rules !== 'chess') throw new Error(`unsupported variant: ${pos.rules}`);
  const baseFen = makeFen(pos.toSetup());

  const moves: { uci: string; san: string }[] = [];
  let moveNo = 0;
  for (const nodeData of game.moves.mainline()) {
    moveNo += 1;
    const move = parseSan(pos, nodeData.san);
    if (!move) throw new Error(`illegal or ambiguous SAN "${nodeData.san}" at move ${moveNo}`);
    moves.push({ uci: makeUci(move), san: nodeData.san });
    pos.play(move);
  }

  return { baseFen, moves, headers: game.headers };
}
