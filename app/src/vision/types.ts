// app/src/vision/types.ts
import type { RgbaImage } from '../lib/capture';
import type { Region } from '../lib/region';
export type { RgbaImage, Region };

export type Orientation = 'white_bottom' | 'black_bottom';

/** Geometric (col,row) — (0,0) at board top-left — to algebraic. Defaults to white_bottom. */
export function squareName(col: number, row: number, orientation: Orientation | null): string {
  if (orientation === 'black_bottom') {
    return `${String.fromCharCode('h'.charCodeAt(0) - col)}${row + 1}`;
  }
  return `${String.fromCharCode('a'.charCodeAt(0) + col)}${8 - row}`;
}

/** Inverse of `squareName`: algebraic name -> geometric (col,row) in the given orientation.
 *  Use to re-express a square named in one orientation frame into another (via squareName). */
export function cellOf(name: string, orientation: Orientation | null): [number, number] {
  const file = name.charCodeAt(0);
  const rank = Number(name[1]);
  if (orientation === 'black_bottom') {
    return ['h'.charCodeAt(0) - file, rank - 1];
  }
  return [file - 'a'.charCodeAt(0), 8 - rank];
}

export interface BoardLocation {
  bbox: Region;
  gridX: number[]; // 9 vertical grid-line x-positions (left -> right)
  gridY: number[]; // 9 horizontal grid-line y-positions (top -> bottom)
  squareSize: number;
  orientationHint: Orientation | null;
  highlightSquares: string[];
  confidence: number;
}

export interface SquareImage { square: string; image: RgbaImage; }
