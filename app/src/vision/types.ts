// app/src/vision/types.ts
import type { RgbaImage } from '../lib/capture';
export type { RgbaImage };

export type Orientation = 'white_bottom' | 'black_bottom';

/** Geometric (col,row) — (0,0) at board top-left — to algebraic. Defaults to white_bottom. */
export function squareName(col: number, row: number, orientation: Orientation | null): string {
  if (orientation === 'black_bottom') {
    return `${String.fromCharCode('h'.charCodeAt(0) - col)}${row + 1}`;
  }
  return `${String.fromCharCode('a'.charCodeAt(0) + col)}${8 - row}`;
}

export interface Region { left: number; top: number; width: number; height: number; }

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
