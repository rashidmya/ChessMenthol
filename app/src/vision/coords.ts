/**
 * vision/coords.ts — Resolve board orientation by reading the board's coordinate
 * labels (the a–h / 1–8 that chess.com and lichess draw at the edges).
 *
 * A 180°-rotated position is itself legal, so orientation cannot be recovered
 * from the pieces alone; the coordinate labels are the external signal that
 * disambiguates. We only need the RANK digit: in white_bottom the top-left board
 * square shows rank 8 and the bottom-left shows rank 1; in black_bottom it is
 * reversed. '8' is a far denser glyph than '1', so we compare the "ink" (contrast
 * pixels) in the two corner labels — no per-font templates needed. The recognizer
 * sits behind readOrientationFromLabels(); a heavier OCR (e.g. Tesseract.js) could
 * later replace the internals without changing callers.
 *
 * Returns null on any uncertainty (no labels, only one corner inked, ambiguous,
 * out of bounds), letting the tracker fall back to guessOrientation and then the
 * manual override.
 */
import type { RgbaImage, BoardLocation, Orientation } from './types';

const CORNER_FRAC = 0.3;   // corner sub-patch size / square (small enough to miss a centered piece)
const INK_THRESH = 40;     // a label pixel deviates from the fill by >= this luminance
const MIN_INK = 0.04;      // the denser corner must exceed this ink fraction (a label is present)
const MIN_LABEL = 0.015;   // the sparser corner must also have SOME ink (both corners are labels)
const RATIO = 1.6;         // the denser must beat the sparser by this ratio (unambiguous)

/** Fraction of a rectangular patch whose pixels deviate from the patch's own
 *  median luminance (the fill colour) by more than INK_THRESH — i.e. glyph ink.
 *  Assumes the ink is a MINORITY (<50%) of the patch so the median lands on the
 *  fill; if ink exceeds 50% the median flips onto the ink and the fraction is
 *  silently inverted. This is why CORNER_FRAC is kept small; the downstream
 *  null-fallback + manual override cover the rare pathological case. Returns 0
 *  for an out-of-bounds or degenerate rectangle. */
export function inkFraction(img: RgbaImage, x0: number, y0: number, w: number, h: number): number {
  const { data, width, height } = img;
  if (w <= 0 || h <= 0 || x0 < 0 || y0 < 0 || x0 + w > width || y0 + h > height) return 0;
  const lum: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * width + (x0 + x)) * 4;
      lum.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
  }
  const base = [...lum].sort((a, b) => a - b)[lum.length >> 1];
  let ink = 0;
  for (const v of lum) if (Math.abs(v - base) > INK_THRESH) ink++;
  return ink / lum.length;
}

/** Ink in the TOP-LEFT corner of the board square at grid cell (col,row). */
function rankCornerInk(img: RgbaImage, loc: BoardLocation, col: number, row: number): number {
  const sq = loc.gridX[col + 1] - loc.gridX[col];
  const s = Math.max(1, Math.floor(sq * CORNER_FRAC));
  return inkFraction(img, loc.gridX[col], loc.gridY[row], s, s);
}

/** Decide orientation from the top (top-left square) and bottom (bottom-left
 *  square) rank-label inks. The denser corner holds '8'. */
export function decide(topInk: number, botInk: number): Orientation | null {
  const hi = Math.max(topInk, botInk);
  const lo = Math.min(topInk, botInk);
  if (hi < MIN_INK) return null;      // no dense label at all (coords off / empty)
  if (lo < MIN_LABEL) return null;    // only one corner inked (likely a lone piece / partial crop)
  if (hi < lo * RATIO) return null;   // both inked but too close (both pieces / ambiguous)
  return topInk > botInk ? 'white_bottom' : 'black_bottom';
}

/** Ink in the LEFT-margin band at the vertical centre of grid row `row` — where
 *  lichess can render margin coordinates. Out-of-frame margins read as 0. */
function rankMarginInk(img: RgbaImage, loc: BoardLocation, row: number): number {
  const sq = loc.gridX[1] - loc.gridX[0];
  const band = Math.max(1, Math.floor(sq * 0.6));
  const x0 = loc.gridX[0] - band;
  const rowH = loc.gridY[row + 1] - loc.gridY[row];
  const y0 = loc.gridY[row] + Math.floor(rowH / 3);
  const h = Math.max(1, Math.floor(rowH / 3));
  return inkFraction(img, x0, y0, band, h);
}

export function readOrientationFromLabels(img: RgbaImage, loc: BoardLocation): Orientation | null {
  if (loc.gridX.length < 9 || loc.gridY.length < 9) return null;
  // chess.com: rank digit inside the top-left corner of each left-column square.
  const inside = decide(rankCornerInk(img, loc, 0, 0), rankCornerInk(img, loc, 0, 7));
  if (inside !== null) return inside;
  // lichess may render coordinates in the left margin instead.
  return decide(rankMarginInk(img, loc, 0), rankMarginInk(img, loc, 7));
}
