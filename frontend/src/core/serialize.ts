/**
 * core/serialize.ts — Ported from the original Python chessmenthol/server/serialize.py (removed in the Svelte+Tauri migration).
 *
 * The Python source is the line-by-line spec.  Output DTO shapes match
 * frontend/src/lib/types.ts exactly (the UI consumes them).
 *
 * All chess logic goes through core/chess.ts; chessops is never imported here.
 */

import type { RgbaImage } from '../lib/capture';
import type { RegionShotFrame } from '../lib/types';
import type { Chess } from './chess';
import { sanOf, playUci, variationSan } from './chess';
import { type Eval, type Line, type AnalysisInfo, formatWhiteEval, bestLine, lineMove } from '../engine/types';
import { type Classification } from './classify';
import type { EvalDto, LineDto, ClassificationDto, LastMoveDto } from '../lib/types';

// ─── PV_PLIES ─────────────────────────────────────────────────────────────────

/** Number of continuation plies to show after each move. */
export const PV_PLIES = 3;

// ─── evalToDict ───────────────────────────────────────────────────────────────

/**
 * Serialise an Eval to an EvalDto.
 * Python: eval_to_dict(ev)
 */
export function evalToDict(ev: Eval): EvalDto {
  return { cp: ev.cp, mate: ev.mate, text: formatWhiteEval(ev) };
}

// ─── lineToDict ───────────────────────────────────────────────────────────────

/**
 * Serialise a Line (with the position it was computed for) to a LineDto.
 * Python: line_to_dict(line, board)
 *
 * line.pv is already string[] UCI — no conversion needed.
 */
export function lineToDict(line: Line, pos: Chess): LineDto {
  return {
    multipv:   line.multipv,
    scoreText: formatWhiteEval(line.eval),
    cp:        line.eval.cp,
    mate:      line.eval.mate,
    pv:        line.pv,
    san:       line.pv.length ? variationSan(pos, line.pv) : '',
  };
}

// ─── analysisToDict ───────────────────────────────────────────────────────────

/**
 * Serialise an AnalysisInfo (with the position it was computed for).
 * Python: analysis_to_dict(analysis, board)
 */
export function analysisToDict(
  analysis: AnalysisInfo,
  pos: Chess,
): { depth: number; eval: EvalDto | null; lines: LineDto[] } {
  const best = bestLine(analysis);
  return {
    depth: analysis.depth,
    eval:  best !== null ? evalToDict(best.eval) : null,
    lines: analysis.lines.map((line) => lineToDict(line, pos)),
  };
}

// ─── classificationToDict ─────────────────────────────────────────────────────

/**
 * Serialise a Classification to a ClassificationDto.
 * Python: classification_to_dict(c)
 *
 * c.label is already a lowercase string (MoveClass enum value) — no .value needed.
 */
export function classificationToDict(c: Classification): ClassificationDto {
  return { label: c.label, cpl: c.cpl, isBest: c.isBest };
}

// ─── continuationSan (private) ────────────────────────────────────────────────

/**
 * SAN of the first `plies` plies of `pv` from `posAfter`, with a trailing
 * ' …' (U+2026) when the real variation is longer. Empty string for an empty pv.
 * Python: _continuation_san(board_after, pv, plies)
 */
function continuationSan(posAfter: Chess, pv: string[], plies: number = PV_PLIES): string {
  if (!pv.length) return '';
  const san = variationSan(posAfter, pv.slice(0, plies));
  if (pv.length > plies) return san + ' …'; // space + HORIZONTAL ELLIPSIS U+2026
  return san;
}

// ─── lastMoveToDict ───────────────────────────────────────────────────────────

/**
 * Enriched `lastMove` payload comparing the played move to the engine's best.
 * Python: last_move_to_dict(c, board_before, move, before_a, after_a, *, plies)
 *
 * Preconditions (guaranteed by the caller):
 *   - bestLine(beforeA) is not null and has at least one move in its PV
 *   - bestLine(afterA) is not null
 * Guards below document these preconditions; they throw on violation.
 *
 * @param c          Move classification
 * @param posBefore  Position BEFORE the played move
 * @param uci        The played move in UCI notation (e.g. 'a2a3')
 * @param beforeA    Engine analysis of the position before the move
 * @param afterA     Engine analysis of the position after the played move
 * @param plies      Continuation depth (default PV_PLIES = 3)
 */
export function lastMoveToDict(
  c:        Classification,
  posBefore: Chess,
  uci:      string,
  beforeA:  AnalysisInfo,
  afterA:   AnalysisInfo,
  plies:    number = PV_PLIES,
): LastMoveDto {
  // ── pre-condition guards ──────────────────────────────────────────────────
  const bestLineBefore = bestLine(beforeA);
  if (bestLineBefore === null) {
    throw new Error('lastMoveToDict: beforeA must have at least one line');
  }
  const bestMoveUci = lineMove(bestLineBefore);
  if (bestMoveUci === null) {
    throw new Error('lastMoveToDict: bestLine(beforeA) must have at least one move in its PV');
  }
  const bestLineAfter = bestLine(afterA);
  if (bestLineAfter === null) {
    throw new Error('lastMoveToDict: afterA must have at least one line');
  }

  // ── positions after each move ─────────────────────────────────────────────
  const afterPlayed = playUci(posBefore, uci);
  const afterBest   = playUci(posBefore, bestMoveUci);

  // ── build DTO ─────────────────────────────────────────────────────────────
  return {
    classification: classificationToDict(c),
    played: {
      san:      sanOf(posBefore, uci),
      uci,
      evalText: formatWhiteEval(bestLineAfter.eval),
      // Full after-best pv (Python: after_a.best.pv)
      pv:       continuationSan(afterPlayed, bestLineAfter.pv, plies),
    },
    best: {
      san:      sanOf(posBefore, bestMoveUci),
      uci:      bestMoveUci,
      evalText: formatWhiteEval(bestLineBefore.eval),
      // Best pv WITHOUT its first move — already the row's name
      // Python: best_line.pv[1:]
      pv:       continuationSan(afterBest, bestLineBefore.pv.slice(1), plies),
    },
  };
}

// ─── regionShotToDict ─────────────────────────────────────────────────────────

/**
 * Encoder signature: receives the target (w, h) and the source image, returns
 * a base64 JPEG string (no data: prefix). Injectable so dimension math is
 * unit-testable in jsdom (which has no OffscreenCanvas).
 */
export type JpegEncoder = (width: number, height: number, scaledFrom: RgbaImage) => Promise<string>;

/** Default encoder: draw the (already-decided) scaled size via OffscreenCanvas, JPEG q80. */
export async function offscreenJpegEncoder(width: number, height: number, src: RgbaImage): Promise<string> {
  const srcCanvas = new OffscreenCanvas(src.width, src.height);
  // Cast: RgbaImage.data is Uint8ClampedArray<ArrayBufferLike> but ImageData needs
  // <ArrayBuffer>; safe because decodeCaptureBuffer always produces a real ArrayBuffer.
  srcCanvas.getContext('2d')!.putImageData(new ImageData(src.data as Uint8ClampedArray<ArrayBuffer>, src.width, src.height), 0, 0);
  const dst = new OffscreenCanvas(width, height);
  const ctx = dst.getContext('2d')!;
  ctx.drawImage(srcCanvas, 0, 0, width, height);
  const blob = await dst.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  // Array.from(...).join avoids the O(n²) string += over a multi-MB JPEG buffer.
  return btoa(Array.from(buf, (b) => String.fromCharCode(b)).join(''));
}

const MAX_WIDTH = 2560;

/**
 * Port of serialize.py::region_shot_to_dict.
 * Downscales to ≤2560 width (no upscale), JPEG q80 via the injected encoder,
 * and returns the TRUE (original) desktop dimensions in the frame.
 */
export async function regionShotToDict(
  image: RgbaImage,
  encode: JpegEncoder = offscreenJpegEncoder,
): Promise<RegionShotFrame> {
  const scale = Math.min(1, MAX_WIDTH / image.width);
  const w = scale >= 1 ? image.width : Math.max(1, Math.round(image.width * scale));
  const h = scale >= 1 ? image.height : Math.max(1, Math.round(image.height * scale));
  return {
    type: 'region_shot',
    jpegBase64: await encode(w, h, image),
    width: image.width,   // TRUE dims
    height: image.height,
  };
}
