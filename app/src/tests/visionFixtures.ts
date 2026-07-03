// app/src/tests/visionFixtures.ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import type { RgbaImage } from '../lib/capture';
import type { BoardLocation, Region, Orientation } from '../vision/types';

// RGB (Python BGR constants reversed per the colour-space convention).
const LIGHT: [number, number, number] = [240, 217, 181];
const DARK: [number, number, number] = [181, 136, 99];
const BG: [number, number, number] = [60, 60, 60];
const HIGHLIGHT: [number, number, number] = [230, 200, 90];
const PIECE: [number, number, number] = [20, 20, 20];

function squareToColRow(sq: string): [number, number] {
  return [sq.charCodeAt(0) - 'a'.charCodeAt(0), 8 - Number(sq[1])];
}

function setPx(img: RgbaImage, x: number, y: number, [r, g, b]: [number, number, number]): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
}

export interface RenderOpts {
  square?: number; margin?: number;
  pieces?: string[]; highlights?: string[];
  coords?: Orientation;       // labels inside the corner squares (chess.com)
  marginCoords?: Orientation; // labels in the left margin (lichess)
}

// Fill `density` of the TOP-LEFT corner-cell of square (col,row) — where chess.com
// draws the rank digit — with a colour that contrasts the square fill, so
// inkFraction sees it as glyph ink. The reader only compares ink density, so the
// exact glyph shape is irrelevant; a dense fill stands in for '8', a sparse one for '1'.
function stampMark(img: RgbaImage, margin: number, square: number,
                   col: number, row: number, density: number): void {
  const isLight = (col + row) % 2 === 0;
  const ink: [number, number, number] = isLight ? [30, 30, 30] : [235, 235, 235];
  const corner = Math.floor(square * 0.3); // matches the reader's CORNER_FRAC
  const target = Math.max(1, Math.floor(corner * corner * density));
  const x0 = margin + col * square, y0 = margin + row * square;
  let drawn = 0;
  for (let dy = 0; dy < corner && drawn < target; dy++)
    for (let dx = 0; dx < corner && drawn < target; dx++) { setPx(img, x0 + dx, y0 + dy, ink); drawn++; }
}

// Draw a rank mark in the LEFT margin, vertically centred on square (col=0,row),
// near the board's left edge — where lichess can render margin coordinates.
function stampMarginMark(img: RgbaImage, margin: number, square: number,
                         row: number, density: number): void {
  // The margin backdrop is the flat BG fill (not an alternating light/dark square
  // like the board itself), so — unlike stampMark — a single ink colour with enough
  // contrast against BG works for every row; no light/dark alternation needed.
  const ink: [number, number, number] = [235, 235, 235];
  const band = Math.floor(square * 0.6);           // matches the reader's margin band width
  const x0 = Math.max(0, margin - band);
  const h = Math.floor(square / 3);
  const y0 = margin + row * square + Math.floor(square / 3);
  const target = Math.max(1, Math.floor(band * h * density));
  let drawn = 0;
  for (let dy = 0; dy < h && drawn < target; dy++)
    for (let dx = 0; dx < band && drawn < target; dx++) { setPx(img, x0 + dx, y0 + dy, ink); drawn++; }
}

export function renderBoard(opts: RenderOpts = {}): { image: RgbaImage; truth: BoardLocation } {
  const square = opts.square ?? 32;
  const margin = opts.margin ?? 16;
  const boardPx = square * 8;
  const canvas = margin * 2 + boardPx;
  const image: RgbaImage = { data: new Uint8ClampedArray(canvas * canvas * 4), width: canvas, height: canvas };
  // background
  for (let y = 0; y < canvas; y++) for (let x = 0; x < canvas; x++) setPx(image, x, y, BG);
  // squares: (col+row) even -> light at top-left so bottom-left (row7,col0) is dark
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const color = (col + row) % 2 === 0 ? LIGHT : DARK;
    for (let dy = 0; dy < square; dy++) for (let dx = 0; dx < square; dx++) {
      setPx(image, margin + col * square + dx, margin + row * square + dy, color);
    }
  }
  // highlights: 0.5 blend with the tint
  for (const sq of opts.highlights ?? []) {
    const [col, row] = squareToColRow(sq);
    for (let dy = 0; dy < square; dy++) for (let dx = 0; dx < square; dx++) {
      const x = margin + col * square + dx, y = margin + row * square + dy;
      const i = (y * image.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        image.data[i + c] = Math.trunc(0.5 * image.data[i + c] + 0.5 * HIGHLIGHT[c]);
      }
    }
  }
  // pieces: filled circle radius square/3 at cell centre
  for (const sq of opts.pieces ?? []) {
    const [col, row] = squareToColRow(sq);
    const cx = margin + col * square + Math.trunc(square / 2);
    const cy = margin + row * square + Math.trunc(square / 2);
    const r = Math.trunc(square / 3);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) setPx(image, cx + dx, cy + dy, PIECE);
    }
  }
  // coordinate labels: dense mark ('8') at the rank-8 corner, sparse ('1') at rank-1.
  if (opts.coords) {
    const eightRow = opts.coords === 'white_bottom' ? 0 : 7; // square showing rank 8
    const oneRow = opts.coords === 'white_bottom' ? 7 : 0;   // square showing rank 1
    stampMark(image, margin, square, 0, eightRow, 0.42);
    stampMark(image, margin, square, 0, oneRow, 0.12);
  }
  if (opts.marginCoords) {
    const eightRow = opts.marginCoords === 'white_bottom' ? 0 : 7;
    const oneRow = opts.marginCoords === 'white_bottom' ? 7 : 0;
    stampMarginMark(image, margin, square, eightRow, 0.5);
    stampMarginMark(image, margin, square, oneRow, 0.15);
  }
  const gridX = Array.from({ length: 9 }, (_, i) => margin + i * square);
  const gridY = gridX.slice();
  const truth: BoardLocation = {
    bbox: { left: margin, top: margin, width: boardPx, height: boardPx },
    gridX, gridY, squareSize: square, orientationHint: 'white_bottom',
    highlightSquares: [...(opts.highlights ?? [])], confidence: 1.0,
  };
  return { image, truth };
}

export function iou(a: Region, b: Region): number {
  const ix0 = Math.max(a.left, b.left), iy0 = Math.max(a.top, b.top);
  const ix1 = Math.min(a.left + a.width, b.left + b.width);
  const iy1 = Math.min(a.top + a.height, b.top + b.height);
  const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  const union = a.width * a.height + b.width * b.height - inter;
  return union ? inter / union : 0;
}

/** Decode a committed PNG fixture to RGBA (pngjs, node test env).
 *  Under jsdom, Vite rewrites this module's `import.meta.url` to a root-relative
 *  `file:///src/...`, so resolve robustly: prefer the file-relative path, then fall
 *  back to the cwd-anchored project path (vitest runs from `app/`). */
export function loadFixturePng(relPath: string): RgbaImage {
  const candidates: string[] = [];
  try {
    const fileDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(fileDir, 'fixtures', 'vision', relPath));
  } catch {
    /* import.meta.url is not a usable file URL in this environment */
  }
  candidates.push(resolve(process.cwd(), 'src', 'tests', 'fixtures', 'vision', relPath));
  const path = candidates.find(existsSync) ?? candidates[candidates.length - 1];
  const png = PNG.sync.read(readFileSync(path));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}
