// vision/pieces.ts — Piece classifier.
//
// Reproduces cv2.dnn.blobFromImages with a hand-rolled OpenCV INTER_LINEAR
// bilinear resize (cross-platform determinism: the same crop classifies
// identically on every OS, unlike <canvas> which is GPU/driver dependent),
// /255 scaling, NCHW [N,3,32,32], RGB plane order (no channel swap — our crops are already RGB),
// the chess-cv class order, and a per-row softmax postprocess.
//
// PieceClassifier is decoupled from the ONNX runtime via an injected `Runner`
// closure, so the SAME class drives onnxruntime-web (in the vision worker) and
// onnxruntime-node (in the parity test); only the runtime differs.
import type { RgbaImage, SquareImage } from './types';
import type { SquareLabel } from './position';

export const INPUT_SIZE = 32;

// chess-cv's pieces-model output order (alphabetical); "xx" == empty.
export const CLASSES = [
  'bB', 'bK', 'bN', 'bP', 'bQ', 'bR',
  'wB', 'wK', 'wN', 'wP', 'wQ', 'wR', 'xx',
] as const;

const XX_INDEX = CLASSES.indexOf('xx');

/** Class index -> 2-char piece code ('wP'..'bK'), or null for the empty class. */
export function classToPiece(index: number): string | null {
  const label = CLASSES[index];
  return label === 'xx' ? null : label;
}

/** 2-char piece code (or null for empty) -> class index. */
export function pieceToClass(piece: string | null): number {
  if (piece === null) return XX_INDEX;
  const index = (CLASSES as readonly string[]).indexOf(piece);
  return index === -1 ? XX_INDEX : index;
}

/**
 * Resize an RGBA image to `size`×`size` matching OpenCV's INTER_LINEAR
 * (bilinear) exactly — the interpolation cv2.dnn.blobFromImages uses (it is
 * bilinear, NOT area-averaging, even when downsampling).
 *
 * Per destination pixel (dx,dy): pixel-center source mapping (align_corners
 * false): fx = (dx+0.5)*srcW/size - 0.5, x0 = floor(fx), ax = fx - x0; clamp
 * x0 and x1 = x0+1 to [0,srcW-1] (border replicate). Same for y. Per channel:
 * out = (1-ay)*((1-ax)*p00 + ax*p01) + ay*((1-ax)*p10 + ax*p11), rounded to
 * nearest uint8. Output alpha = 255 (preprocess only reads R,G,B).
 */
export function resizeBilinear(img: RgbaImage, size: number): RgbaImage {
  const { data: src, width: srcW, height: srcH } = img;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let dy = 0; dy < size; dy++) {
    const fy = (dy + 0.5) * srcH / size - 0.5;
    const y0f = Math.floor(fy);
    const ay = fy - y0f;
    const y0 = y0f < 0 ? 0 : y0f > srcH - 1 ? srcH - 1 : y0f;
    const y1u = y0f + 1;
    const y1 = y1u < 0 ? 0 : y1u > srcH - 1 ? srcH - 1 : y1u;
    for (let dx = 0; dx < size; dx++) {
      const fx = (dx + 0.5) * srcW / size - 0.5;
      const x0f = Math.floor(fx);
      const ax = fx - x0f;
      const x0 = x0f < 0 ? 0 : x0f > srcW - 1 ? srcW - 1 : x0f;
      const x1u = x0f + 1;
      const x1 = x1u < 0 ? 0 : x1u > srcW - 1 ? srcW - 1 : x1u;
      // four source pixel offsets (RGBA, 4 bytes/pixel)
      const i00 = (y0 * srcW + x0) * 4;
      const i01 = (y0 * srcW + x1) * 4;
      const i10 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;
      const o = (dy * size + dx) * 4;
      for (let c = 0; c < 3; c++) {
        const top = (1 - ax) * src[i00 + c] + ax * src[i01 + c];
        const bot = (1 - ax) * src[i10 + c] + ax * src[i11 + c];
        out[o + c] = Math.round((1 - ay) * top + ay * bot);
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: size, height: size };
}

/**
 * RGBA crops -> (N,3,32,32) float32 NCHW blob, /255, plane order R,G,B.
 *
 * Matches cv2.dnn.blobFromImages(swapRB=True) on BGR crops: that swap turns
 * BGR into RGB, and our crops are already RGB, so we feed R,G,B directly (no
 * swap). Channel c = 0,1,2 reads RGBA channels [0,1,2]; alpha is ignored.
 */
export function preprocess(crops: RgbaImage[]): Float32Array {
  const n = crops.length;
  const plane = INPUT_SIZE * INPUT_SIZE;
  const blob = new Float32Array(n * 3 * plane);
  for (let i = 0; i < n; i++) {
    const px = resizeBilinear(crops[i], INPUT_SIZE).data;
    for (let c = 0; c < 3; c++) {
      const base = (i * 3 + c) * plane;
      for (let y = 0; y < INPUT_SIZE; y++) {
        for (let x = 0; x < INPUT_SIZE; x++) {
          blob[base + y * INPUT_SIZE + x] = px[(y * INPUT_SIZE + x) * 4 + c] / 255;
        }
      }
    }
  }
  return blob;
}

/** (N,13) row-major logits -> N SquareLabels (per-row softmax; max = confidence). */
export function postprocess(logits: Float32Array, n: number): SquareLabel[] {
  const k = CLASSES.length; // 13
  const out: SquareLabel[] = [];
  for (let i = 0; i < n; i++) {
    const off = i * k;
    let max = -Infinity;
    for (let j = 0; j < k; j++) if (logits[off + j] > max) max = logits[off + j];
    let sum = 0;
    let bestProb = -Infinity;
    let bestIndex = 0;
    const probs = new Float64Array(k);
    for (let j = 0; j < k; j++) {
      const e = Math.exp(logits[off + j] - max);
      probs[j] = e;
      sum += e;
    }
    for (let j = 0; j < k; j++) {
      const p = probs[j] / sum;
      if (p > bestProb) {
        bestProb = p;
        bestIndex = j;
      }
    }
    out.push({ piece: classToPiece(bestIndex), confidence: bestProb });
  }
  return out;
}

/** ONNX inference session surface shared by onnxruntime-web and onnxruntime-node. */
export interface InferenceLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
  inputNames: readonly string[];
  outputNames: readonly string[];
}

/** Runs a preprocessed blob through the model, returning n*13 logits. */
export type Runner = (blob: Float32Array, n: number) => Promise<Float32Array>;

/**
 * Classifies square crops into SquareLabels. Decoupled from the ONNX runtime:
 * the caller supplies a `Runner` (build one with `ortRunner`).
 */
export class PieceClassifier {
  constructor(private run: Runner) {}

  async classify(crops: SquareImage[]): Promise<SquareLabel[]> {
    if (crops.length === 0) return [];
    const logits = await this.run(preprocess(crops.map((c) => c.image)), crops.length);
    return postprocess(logits, crops.length);
  }
}

/**
 * Build a Runner from an onnxruntime InferenceSession (web or node). The Tensor
 * constructor is injected because it differs between ort-web and ort-node, so
 * this module imports nothing from onnxruntime.
 */
export function ortRunner(
  session: InferenceLike,
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown,
): Runner {
  return async (blob, n) => {
    const feeds = { [session.inputNames[0]]: new Tensor('float32', blob, [n, 3, INPUT_SIZE, INPUT_SIZE]) };
    const out = await session.run(feeds);
    return out[session.outputNames[0]].data;
  };
}
