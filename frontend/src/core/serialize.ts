/**
 * core/serialize.ts — TypeScript port of chessmenthol/server/serialize.py.
 *
 * The Python source is the line-by-line spec.  Output DTO shapes match
 * frontend/src/lib/types.ts exactly (the UI consumes them).
 *
 * All chess logic goes through core/chess.ts; chessops is never imported here.
 */

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
