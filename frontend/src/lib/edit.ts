/** Pure helpers for edit mode: FEN assembly, validation, token/coord mapping. */

export interface CgPiece {
  role: 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
  color: 'white' | 'black';
}

const ROLE: Record<string, CgPiece['role']> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

/** Expand a FEN placement field into an 8x8 grid; row 0 = rank 8, col 0 = file a. */
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

export function kingCountOk(placement: string): boolean {
  const w = (placement.match(/K/g) || []).length;
  const b = (placement.match(/k/g) || []).length;
  return w === 1 && b === 1;
}

/** Assemble a full FEN: side from the argument, castling inferred from king/rook
 *  home squares, en-passant '-', counters '0 1'. */
export function buildFen(placement: string, sideToMove: 'white' | 'black'): string {
  const g = parsePlacement(placement);
  const at = (row: number, col: number): string | null => g[row]?.[col] ?? null;
  // rank 1 row = g[7], rank 8 row = g[0]; files a..h = cols 0..7.
  const wK = at(7, 4) === 'K';
  const bK = at(0, 4) === 'k';
  let castle = '';
  if (wK && at(7, 7) === 'R') castle += 'K';
  if (wK && at(7, 0) === 'R') castle += 'Q';
  if (bK && at(0, 7) === 'r') castle += 'k';
  if (bK && at(0, 0) === 'r') castle += 'q';
  if (castle === '') castle = '-';
  const turn = sideToMove === 'white' ? 'w' : 'b';
  return `${placement} ${turn} ${castle} - 0 1`;
}

export function pieceFromToken(tok: string): CgPiece {
  return { role: ROLE[tok.toLowerCase()], color: tok === tok.toUpperCase() ? 'white' : 'black' };
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
