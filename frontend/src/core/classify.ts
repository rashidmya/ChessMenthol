/**
 * core/classify.ts — TypeScript port of chessmenthol/analysis/classify.py.
 *
 * Faithful line-by-line port; the Python source is the spec.  See the
 * "Preserve these faithful quirks" note in the task brief for intentional
 * edge-case behaviour (en-passant gain=0, promotion risked = promoted piece).
 *
 * All chess logic is routed through core/chess.ts; chessops is never imported
 * directly here.
 */

import { type Chess, type Role, type SquareName, attackedBy, playUci, roleAt } from './chess';
import { type BookLookup, NoBook } from './book';
import { type AnalysisInfo, bestLine, evalPov, lineMove } from '../engine/types';

// ─── MoveClass ────────────────────────────────────────────────────────────────

export enum MoveClass {
  BRILLIANT  = 'brilliant',
  GREAT      = 'great',
  BEST       = 'best',
  EXCELLENT  = 'excellent',
  GOOD       = 'good',
  BOOK       = 'book',
  INACCURACY = 'inaccuracy',
  MISTAKE    = 'mistake',
  BLUNDER    = 'blunder',
  MISS       = 'miss',
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

export interface Thresholds {
  excellentMax:    number;  // cpl <= => EXCELLENT
  goodMax:         number;  // cpl <= => GOOD
  inaccuracyMax:   number;  // cpl <= => INACCURACY
  mistakeMax:      number;  // cpl <= => MISTAKE (else BLUNDER)
  greatGap:        number;  // best better than 2nd-best by this => only-move (GREAT)
  brilliantMaxCpl: number;  // near-best ceiling to still be BRILLIANT
  brilliantKeep:   number;  // mover-POV eval after move must stay >= this for BRILLIANT
  sacrificeMin:    number;  // (risked − gained) material floor for a sacrifice
  missWin:         number;  // had at least this (mover POV) => was winning
  missKeep:        number;  // dropped below this => threw the win (MISS)
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  excellentMax:    20,
  goodMax:         50,
  inaccuracyMax:  100,
  mistakeMax:     250,
  greatGap:       150,
  brilliantMaxCpl: 30,
  brilliantKeep:  -50,
  sacrificeMin:   200,
  missWin:        200,
  missKeep:       100,
};

// ─── PIECE_VALUE ──────────────────────────────────────────────────────────────

/** Centipawn value of each piece type (mirrors Python PIECE_VALUE dict). */
export const PIECE_VALUE: Record<Role, number> = {
  pawn:   100,
  knight: 300,
  bishop: 300,
  rook:   500,
  queen:  900,
  king:     0,
};

// ─── Classification ───────────────────────────────────────────────────────────

export interface Classification {
  label:  MoveClass;
  cpl:    number;   // centipawn loss vs best move, mover POV, >= 0
  isBest: boolean;
}

// ─── isSacrifice ─────────────────────────────────────────────────────────────

/**
 * Heuristic: did the move offer material on its destination square?
 *
 * Faithful port of Python `is_sacrifice`.  Intentional quirks preserved:
 *   • En-passant: the captured pawn is NOT on the destination square before the
 *     move, so `roleAt(posBefore, dest)` is undefined → gain = 0.
 *   • Promotions: `uci.slice(2,4)` is the destination; after the move, the
 *     piece there is the promoted piece, so `risked` = promoted piece's value.
 */
export function isSacrifice(
  posBefore:  Chess,
  uci:        string,
  thresholds?: Thresholds,
): boolean {
  const t = thresholds ?? DEFAULT_THRESHOLDS;
  // Columns 2–3 of any UCI string are the destination square ('e2e4' → 'e4', 'e7e8q' → 'e8').
  const dest = uci.slice(2, 4) as SquareName;

  // Material on the destination BEFORE the move (captured piece, if any).
  const capturedRole = roleAt(posBefore, dest);
  const gain         = capturedRole !== undefined ? PIECE_VALUE[capturedRole] : 0;

  // Position AFTER the move.
  const after     = playUci(posBefore, uci);
  const movedRole = roleAt(after, dest);
  if (movedRole === undefined) return false;   // shouldn't happen for legal moves

  const risked   = PIECE_VALUE[movedRole];
  const opponent = posBefore.turn === 'white' ? 'black' : 'white'; // Python: not mover

  if (attackedBy(after, dest, opponent)) {
    return (risked - gain) >= t.sacrificeMin;
  }
  return false;
}

// ─── classifyMove ─────────────────────────────────────────────────────────────

/**
 * Classify a played move.  Faithful port of Python `classify_move`.
 *
 * Throws (like the Python ValueError) when:
 *   • `analysisBefore` has no lines, or its first line has no move in its PV.
 *   • `analysisAfter` has no lines.
 *
 * @param posBefore      Position BEFORE the move (used for turn color, book lookup,
 *                       and sacrifice detection).
 * @param uci            The played move in UCI notation (e.g. `'e2e4'`).
 * @param analysisBefore Engine analysis of the position before the move.
 * @param analysisAfter  Engine analysis of the position after the move
 *                       (used to measure the eval after the played move).
 * @param book           Optional opening-book implementation; defaults to NoBook.
 * @param thresholds     Optional threshold overrides; defaults to DEFAULT_THRESHOLDS.
 */
export function classifyMove(
  posBefore:      Chess,
  uci:            string,
  analysisBefore: AnalysisInfo,
  analysisAfter:  AnalysisInfo,
  book?:          BookLookup,
  thresholds?:    Thresholds,
): Classification {
  const t  = thresholds ?? DEFAULT_THRESHOLDS;
  const bk = book ?? new NoBook();

  const moverWhite = posBefore.turn === 'white';

  // ── best line before the move ─────────────────────────────────────────────
  const bestLineBefore = bestLine(analysisBefore);
  const bestMoveUci    = bestLineBefore !== null ? lineMove(bestLineBefore) : null;
  if (bestLineBefore === null || bestMoveUci === null) {
    throw new Error('analysis_before must contain at least one line with a move');
  }
  const bestMover = evalPov(bestLineBefore.eval, moverWhite);

  // ── best line after the move (measures played eval) ──────────────────────
  const afterBest = bestLine(analysisAfter);
  if (afterBest === null) {
    throw new Error('analysis_after must contain at least one line');
  }
  const playedMover = evalPov(afterBest.eval, moverWhite);

  // ── derived quantities ────────────────────────────────────────────────────
  const cpl    = Math.max(0, bestMover - playedMover);
  const isBest = uci === bestMoveUci;

  let secondGap: number | null = null;
  if (analysisBefore.lines.length >= 2) {
    const secondMover = evalPov(analysisBefore.lines[1].eval, moverWhite);
    secondGap = bestMover - secondMover;
  }

  // ── ordered classification rules (exact Python ordering) ─────────────────

  // 1. Book
  if (bk.containsMove(posBefore, uci)) {
    return { label: MoveClass.BOOK, cpl, isBest };
  }

  // 2. Brilliant: near-best, sound sacrifice, eval stays acceptable
  const nearBest = cpl <= t.brilliantMaxCpl;
  if (nearBest && playedMover >= t.brilliantKeep && isSacrifice(posBefore, uci, t)) {
    return { label: MoveClass.BRILLIANT, cpl, isBest };
  }

  // 3. Great: only move that holds (best by a wide margin over the alternative)
  if (isBest && secondGap !== null && secondGap >= t.greatGap) {
    return { label: MoveClass.GREAT, cpl, isBest };
  }

  // 4. Plain best
  if (isBest) {
    return { label: MoveClass.BEST, cpl, isBest };
  }

  // 5. Miss: a win was available and got thrown away
  if (bestMover >= t.missWin && playedMover < t.missKeep) {
    return { label: MoveClass.MISS, cpl, isBest };
  }

  // 6. Centipawn-loss bands
  if (cpl <= t.excellentMax)  return { label: MoveClass.EXCELLENT,  cpl, isBest };
  if (cpl <= t.goodMax)       return { label: MoveClass.GOOD,       cpl, isBest };
  if (cpl <= t.inaccuracyMax) return { label: MoveClass.INACCURACY, cpl, isBest };
  if (cpl <= t.mistakeMax)    return { label: MoveClass.MISTAKE,    cpl, isBest };
  return { label: MoveClass.BLUNDER, cpl, isBest };
}
