// vision/detect.ts — Axis-aligned chessboard detection via grayscale + Sobel edge profiles
// + autocorrelation period finding + brute-force phase + checker confidence/orientation/highlights.
// Pure array math over an RgbaImage (no OpenCV).
import { squareName } from './types';
import type { BoardLocation, Orientation, RgbaImage, SquareImage } from './types';

const MIN_SQUARE = 6;
const CELL_INSET_DIVISOR = 8; // trim 1/8 of each cell side when sampling its mean color
const CROP_INSET_DIVISOR = 12; // 1/12 inset — intentionally wider than cellMeans's 1/8
const CHECKER_SPREAD_WEIGHT = 2.0; // how strongly within-group color spread penalizes confidence
// Detection gate. Real fixtures with full piece sets score ~0.56-0.75 (a denser
// synthetic 32-piece start ~0.36); random noise scores ~0.15 and is rejected
// structurally by the period finder, so this gate is a backstop sitting between
// the occluded-board and noise confidence floors.
const DEFAULT_MIN_CONFIDENCE = 0.3;

// Last-move-highlight detection. Corners are sampled (not the centre) so a piece on the
// destination square doesn't wash out its translucent overlay; a "warm" gate keeps
// yellow/green last-move tints and drops red check/premove highlights (thin overlays
// like arrows are only diluted below the margin, not guaranteed rejected).
const HIGHLIGHT_CORNER_FRAC = 0.2; // corner patch size as a fraction of the cell
const WARM_TINT_MARGIN = 8;        // R and G must each exceed B by this many levels (also the noise floor)

// --- small numeric helpers (numpy parity: population std ddof=0, banker's round) ---

function mean(a: number[]): number {
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

function std(a: number[]): number {
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return Math.sqrt(s / a.length);
}

function clip(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Python 3 round(): round half to even. Used so an odd (sx+sy) matches Python. */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Luma grayscale round(0.299*R + 0.587*G + 0.114*B) from RGBA channels [0,1,2];
 *  integer-valued, returned as float (matches cv2.cvtColor(BGR2GRAY).astype(float32)). */
function grayscale(image: RgbaImage): Float64Array {
  const { data, width, height } = image;
  const gray = new Float64Array(width * height);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    gray[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return gray;
}

/** Reflect-101 index: mirror about the edge without repeating it (-1 -> 1, n -> n-2). */
function reflect(i: number, n: number): number {
  if (i < 0) return -i;
  if (i >= n) return 2 * n - 2 - i;
  return i;
}

/** Sobel ksize=3 (BORDER_REFLECT_101), absolute gradients summed into edge profiles:
 *  colProfile[x] = Σ_y |Gx|(x,y) (length W); rowProfile[y] = Σ_x |Gy|(x,y) (length H). */
function edgeProfiles(
  gray: Float64Array,
  width: number,
  height: number,
): { colProfile: Float64Array; rowProfile: Float64Array } {
  const colProfile = new Float64Array(width);
  const rowProfile = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const ym = reflect(y - 1, height) * width;
    const yc = y * width;
    const yp = reflect(y + 1, height) * width;
    for (let x = 0; x < width; x++) {
      const xm = reflect(x - 1, width);
      const xp = reflect(x + 1, width);
      const v00 = gray[ym + xm], v01 = gray[ym + x], v02 = gray[ym + xp];
      const v10 = gray[yc + xm], v12 = gray[yc + xp];
      const v20 = gray[yp + xm], v21 = gray[yp + x], v22 = gray[yp + xp];
      // Gx = [[-1,0,1],[-2,0,2],[-1,0,1]]; Gy = Gxᵀ. abs(); sign-flip-invariant under abs.
      const gx = -v00 + v02 - 2 * v10 + 2 * v12 - v20 + v22;
      const gy = -v00 - 2 * v01 - v02 + v20 + 2 * v21 + v22;
      colProfile[x] += Math.abs(gx);
      rowProfile[y] += Math.abs(gy);
    }
  }
  return { colProfile, rowProfile };
}

/** Dominant period via autocorrelation: subtract the mean, full autocorrelation for
 *  lags 0..n-1, window [lo, min(maxSq+1, n-1)); return the SMALLEST lag whose
 *  autocorrelation is within 90% of the window peak (biases toward the fundamental). */
function dominantPeriod(profile: Float64Array, maxSq: number): number | null {
  const n = profile.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += profile[i];
  m /= n;
  const p = new Float64Array(n);
  for (let i = 0; i < n; i++) p[i] = profile[i] - m;

  const lo = MIN_SQUARE;
  const hi = Math.min(maxSq + 1, n - 1); // +1 makes maxSq an included lag
  if (hi <= lo) return null;

  const ac = new Float64Array(hi - lo);
  let peak = -Infinity;
  for (let lag = lo; lag < hi; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += p[i] * p[i + lag];
    ac[lag - lo] = s;
    if (s > peak) peak = s;
  }
  if (peak <= 0) return null;
  const threshold = 0.9 * peak;
  for (let k = 0; k < ac.length; k++) {
    if (ac[k] >= threshold) return lo + k; // smallest qualifying lag
  }
  return null; // unreachable: the peak itself qualifies
}

/** Brute-force the phase: place `teeth` teeth spaced by `period` and pick the start
 *  maximizing the summed profile; the final tooth is clamped in-bounds (flush board). */
function bestPhase(profile: Float64Array, period: number, teeth = 9): number[] | null {
  const n = profile.length;
  const span = period * (teeth - 1);
  if (span > n) return null;
  let bestStart = 0;
  let bestScore = -1.0;
  for (let start = 0; start <= n - span; start++) {
    let score = 0;
    for (let k = 0; k < teeth; k++) {
      score += profile[Math.min(start + period * k, n - 1)];
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  const result: number[] = [];
  for (let k = 0; k < teeth; k++) result.push(Math.min(bestStart + period * k, n - 1));
  return result;
}

/** Per-cell mean RGB over a 1/8-inset sub-rect; 8×8×3 (means[row][col] = [R,G,B]). */
function cellMeans(image: RgbaImage, gridX: number[], gridY: number[]): number[][][] {
  const { data, width } = image;
  const means: number[][][] = [];
  for (let row = 0; row < 8; row++) {
    const rowMeans: number[][] = [];
    for (let col = 0; col < 8; col++) {
      const x0 = gridX[col], x1 = gridX[col + 1];
      const y0 = gridY[row], y1 = gridY[row + 1];
      const ix = Math.max(1, Math.floor((x1 - x0) / CELL_INSET_DIVISOR));
      const iy = Math.max(1, Math.floor((y1 - y0) / CELL_INSET_DIVISOR));
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let y = y0 + iy; y < y1 - iy; y++) {
        let i = (y * width + (x0 + ix)) * 4;
        for (let x = x0 + ix; x < x1 - ix; x++, i += 4) {
          sr += data[i];
          sg += data[i + 1];
          sb += data[i + 2];
          cnt++;
        }
      }
      rowMeans.push(cnt > 0 ? [sr / cnt, sg / cnt, sb / cnt] : [0, 0, 0]);
    }
    means.push(rowMeans);
  }
  return means;
}

/** Per-cell mean RGB over the four corner sub-patches (HIGHLIGHT_CORNER_FRAC of the cell).
 *  The corners fall outside a centred piece's footprint, so an occupied square still
 *  reports its translucent last-move overlay — which cellMeans' centre sample washes out.
 *  8×8×3 (out[row][col] = [R,G,B]). */
function cornerMeans(image: RgbaImage, gridX: number[], gridY: number[]): number[][][] {
  const { data, width } = image;
  const out: number[][][] = [];
  for (let row = 0; row < 8; row++) {
    const rowOut: number[][] = [];
    for (let col = 0; col < 8; col++) {
      const x0 = gridX[col], x1 = gridX[col + 1];
      const y0 = gridY[row], y1 = gridY[row + 1];
      const pw = Math.max(1, Math.floor((x1 - x0) * HIGHLIGHT_CORNER_FRAC));
      const ph = Math.max(1, Math.floor((y1 - y0) * HIGHLIGHT_CORNER_FRAC));
      const corners: [number, number][] = [
        [x0, y0], [x1 - pw, y0], [x0, y1 - ph], [x1 - pw, y1 - ph],
      ];
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (const [cx, cy] of corners) {
        for (let y = cy; y < cy + ph; y++) {
          let i = (y * width + cx) * 4;
          for (let x = cx; x < cx + pw; x++, i += 4) {
            sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; cnt++;
          }
        }
      }
      rowOut.push(cnt > 0 ? [sr / cnt, sg / cnt, sb / cnt] : [0, 0, 0]);
    }
    out.push(rowOut);
  }
  return out;
}

/** Channel-averaged cell means (means.mean(axis=2)) — the (R+G+B)/3 used by the
 *  confidence/orientation gates (NOT luma grayscale). */
function grayMeansOf(means: number[][][]): number[][] {
  return means.map((row) => row.map(([r, g, b]) => (r + g + b) / 3));
}

/** Checker confidence: |mean(light)-mean(dark)| / (sep + 2*avg-within-group-spread). */
function checkerConfidence(grayMeans: number[][]): number {
  const light: number[] = [];
  const dark: number[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      ((c + r) % 2 === 0 ? light : dark).push(grayMeans[r][c]);
    }
  }
  const sep = Math.abs(mean(light) - mean(dark));
  const spread = (std(light) + std(dark)) / 2 + 1e-6;
  return clip(sep / (sep + CHECKER_SPREAD_WEIGHT * spread), 0, 1);
}

/** Per-parity brightness "hint". NOTE: this cannot truly distinguish white_bottom
 *  from black_bottom — a chessboard's coloring is symmetric under 180° rotation, so
 *  bottom-left (row7,col0) is a dark square in BOTH orientations and this returns
 *  'white_bottom' for any real board. It is therefore a constant default, not an
 *  orientation detector: the piece-based `guessOrientation` (position.ts) is what
 *  actually resolves a Black-side board in the tracker. Kept only as a last-resort
 *  fallback and to name crops in a fixed geometric frame (the naming cancels out). */
function orientationHint(grayMeans: number[][]): Orientation | null {
  const even: number[] = [];
  const odd: number[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      ((c + r) % 2 === 0 ? even : odd).push(grayMeans[r][c]);
    }
  }
  const evenMean = mean(even);
  const oddMean = mean(odd);
  if (Math.abs(evenMean - oddMean) < 1e-3) return null;
  const bottomLeftIsDark = oddMean < evenMean;
  return bottomLeftIsDark ? 'white_bottom' : 'black_bottom';
}

/** True when a deviation vector points "warm" — red AND green both elevated relative to
 *  blue — the signature of a yellow/green last-move overlay, independent of the (light or
 *  dark) square underneath. Rejects red (check/premove: green not elevated), blue, and
 *  grayscale (coordinate glyphs / shadows). */
function isWarmTint(d: number[]): boolean {
  return d[0] - d[2] > WARM_TINT_MARGIN && d[1] - d[2] > WARM_TINT_MARGIN;
}

/** Last-move highlight pair: the two strongest cells (by corner-sampled deviation from the
 *  per-parity base) whose deviation is a warm (yellow/green) tint. Returns the pair, or []
 *  when fewer than two qualify — the detection-layer fail-safe. The warm gate doubles as the
 *  noise floor (a warm cell must have R and G each ≥ WARM_TINT_MARGIN over B — a real tint),
 *  so there is deliberately NO separate statistical threshold: a mean+Kσ cutoff over all
 *  cells would be inflated by a strong non-warm outlier (e.g. a red premove square) and could
 *  then suppress a genuine warm pair. L2 magnitude is channel-order invariant; the warm gate
 *  is hue-directional. */
function highlightSquares(corner: number[][][], orientation: Orientation | null): string[] {
  const base0 = [0, 0, 0], base1 = [0, 0, 0];
  let n0 = 0, n1 = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const m = corner[r][c];
      if ((c + r) % 2 === 0) { base0[0] += m[0]; base0[1] += m[1]; base0[2] += m[2]; n0++; }
      else { base1[0] += m[0]; base1[1] += m[1]; base1[2] += m[2]; n1++; }
    }
  }
  for (let k = 0; k < 3; k++) { base0[k] /= n0; base1[k] /= n1; }

  const cand: [number, number, number][] = []; // (mag, col, row)
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const base = (c + r) % 2 === 0 ? base0 : base1;
      const m = corner[r][c];
      const d = [m[0] - base[0], m[1] - base[1], m[2] - base[2]];
      if (!isWarmTint(d)) continue;
      const mag = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      cand.push([mag, c, r]);
    }
  }
  // Descending by (mag, col, row) — deterministic tiebreak, mirrors the prior code.
  cand.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  if (cand.length < 2) return [];
  return cand.slice(0, 2).map(([, c, r]) => squareName(c, r, orientation));
}

/** python-chess square index (a1=0 .. h8=63). */
function squareSortKey(name: string): number {
  const fileIdx = name.charCodeAt(0) - 'a'.charCodeAt(0);
  const rankIdx = Number(name[1]) - 1;
  return rankIdx * 8 + fileIdx;
}

/** Crop the 64 cells (1/12 inset) into SquareImages, sorted into canonical a1..h8 order. */
export function cropSquares(image: RgbaImage, location: BoardLocation): SquareImage[] {
  const { data, width } = image;
  const crops: SquareImage[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const x0 = location.gridX[col], x1 = location.gridX[col + 1];
      const y0 = location.gridY[row], y1 = location.gridY[row + 1];
      const ix = Math.max(1, Math.floor((x1 - x0) / CROP_INSET_DIVISOR));
      const iy = Math.max(1, Math.floor((y1 - y0) / CROP_INSET_DIVISOR));
      const xs = x0 + ix, ys = y0 + iy;
      const cw = Math.max(0, x1 - ix - xs);
      const ch = Math.max(0, y1 - iy - ys);
      const out = new Uint8ClampedArray(cw * ch * 4);
      for (let y = 0; y < ch; y++) {
        const srcStart = ((ys + y) * width + xs) * 4;
        out.set(data.subarray(srcStart, srcStart + cw * 4), y * cw * 4);
      }
      crops.push({
        square: squareName(col, row, location.orientationHint),
        image: { data: out, width: cw, height: ch },
      });
    }
  }
  crops.sort((a, b) => squareSortKey(a.square) - squareSortKey(b.square));
  return crops;
}

/** Detect an axis-aligned chessboard. Returns null when no checker board is found
 *  (no dominant period, no valid phase, or confidence < minConfidence). */
export function detect(
  image: RgbaImage,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
): BoardLocation | null {
  const { width: w, height: h } = image;
  const gray = grayscale(image);
  const { colProfile, rowProfile } = edgeProfiles(gray, w, h);
  const maxSq = Math.floor(Math.min(w, h) / 8);
  const sx = dominantPeriod(colProfile, maxSq);
  const sy = dominantPeriod(rowProfile, maxSq);
  if (sx === null || sy === null) return null;
  // Online boards have square cells, so the x and y pitches agree; averaging denoises.
  const period = pyRound((sx + sy) / 2);
  const gridX = bestPhase(colProfile, period);
  const gridY = bestPhase(rowProfile, period);
  if (gridX === null || gridY === null) return null;

  const means = cellMeans(image, gridX, gridY);
  const grayMeans = grayMeansOf(means);
  const confidence = checkerConfidence(grayMeans);
  if (confidence < minConfidence) return null;

  const bbox = {
    left: gridX[0],
    top: gridY[0],
    width: gridX[8] - gridX[0],
    height: gridY[8] - gridY[0],
  };
  const orientation = orientationHint(grayMeans);
  const highlights = highlightSquares(cornerMeans(image, gridX, gridY), orientation);
  return {
    bbox,
    gridX,
    gridY,
    squareSize: period,
    orientationHint: orientation,
    highlightSquares: highlights,
    confidence,
  };
}
