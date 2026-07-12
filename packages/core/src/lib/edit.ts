/** Pure helpers for edit mode: FEN assembly, validation, token/coord mapping. */

export interface CgPiece {
  role: 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
  color: 'white' | 'black';
}

const ROLE: Record<string, CgPiece['role']> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

/** Expand a FEN placement field into an 8x8 grid; row 0 = rank 8, col 0 = file a.
 *  Malformed input (wrong rank/file count) degrades gracefully because buildFen's
 *  at() uses optional chaining; in practice input always comes from chessground's
 *  getFen, which yields a well-formed placement. */
function parsePlacement(placement: string): (string | null)[][] {
  return placement.split('/').map((row) => {
    const cells: (string | null)[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push(null);
      else cells.push(ch);
    }
    return cells;
  });
}

export interface CastlingRights { K: boolean; Q: boolean; k: boolean; q: boolean; }

/** Read the castling field (3rd token) of a FEN into explicit booleans. */
export function castleFromFen(fen: string): CastlingRights {
  const field = fen.split(' ')[2] ?? '-';
  return {
    K: field.includes('K'), Q: field.includes('Q'),
    k: field.includes('k'), q: field.includes('q'),
  };
}

export function kingCountOk(placement: string): boolean {
  const w = (placement.match(/K/g) || []).length;
  const b = (placement.match(/k/g) || []).length;
  return w === 1 && b === 1;
}

/** Assemble a full FEN: side from the argument, en-passant '-', counters '0 1'.
 *  Castling is taken from `rights` when given, else inferred from king/rook home squares. */
export function buildFen(
  placement: string,
  sideToMove: 'white' | 'black',
  rights?: CastlingRights,
): string {
  const g = parsePlacement(placement);
  const at = (row: number, col: number): string | null => g[row]?.[col] ?? null;
  let castle = '';
  if (rights) {
    if (rights.K) castle += 'K';
    if (rights.Q) castle += 'Q';
    if (rights.k) castle += 'k';
    if (rights.q) castle += 'q';
  } else {
    // rank 1 row = g[7], rank 8 row = g[0]; files a..h = cols 0..7.
    const wK = at(7, 4) === 'K';
    const bK = at(0, 4) === 'k';
    if (wK && at(7, 7) === 'R') castle += 'K';
    if (wK && at(7, 0) === 'R') castle += 'Q';
    if (bK && at(0, 7) === 'r') castle += 'k';
    if (bK && at(0, 0) === 'r') castle += 'q';
  }
  if (castle === '') castle = '-';
  const turn = sideToMove === 'white' ? 'w' : 'b';
  return `${placement} ${turn} ${castle} - 0 1`;
}

export function pieceFromToken(tok: string): CgPiece {
  const role = ROLE[tok.toLowerCase()];
  if (role === undefined) throw new Error(`Unknown piece token: ${tok}`);
  return { role, color: tok === tok.toUpperCase() ? 'white' : 'black' };
}

/** Map a pixel offset within a square board element to a square key, given orientation. */
export function coordsToKey(
  x: number, y: number, width: number, height: number, orientation: 'white' | 'black',
): string {
  const file = Math.min(7, Math.max(0, Math.floor(x / (width / 8))));
  const rank = Math.min(7, Math.max(0, Math.floor(y / (height / 8))));
  const f = orientation === 'white' ? file : 7 - file;
  const r = orientation === 'white' ? 7 - rank : rank;
  return 'abcdefgh'[f] + (r + 1);
}
