/**
 * core/classify.ts — Ported from the original Python chessmenthol/analysis/classify.py (removed in the Svelte+Tauri migration).
 *
 * Faithful line-by-line port; the Python source is the spec.  See the
 * "Preserve these faithful quirks" note in the task brief for intentional
 * edge-case behaviour (en-passant gain=0, promotion risked = promoted piece).
 *
 * All chess logic is routed through core/chess.ts; chessops is never imported
 * directly here.
 *
 * DELIBERATE DIVERGENCE from the Python port (PGN-import / computer-analysis
 * report feature): the final band decision for Inaccuracy / Mistake / Blunder
 * (previously a centipawn-loss ladder) is now driven by the Lichess
 * winning-chances drop on the [-1,+1] scale, matching Lichess's MoveClassifier
 * / MateAdvice logic.
 *
 * DELIBERATE DIVERGENCE #2 (chess.com-style Game Review): Brilliant is now a
 * chess.com-parity "sound sacrifice".  The old attack-only heuristic flagged any
 * near-best move that placed a piece on a square an enemy piece merely touched —
 * badly over-detecting brilliants on defended outposts, equal trades and
 * recaptures.  `isSacrifice` is now defender-aware via a static exchange
 * evaluation (only a piece the opponent can truly win material on counts), and
 * Brilliant additionally requires the mover was not already clearly winning.
 *
 * DELIBERATE DIVERGENCE #3 (chess.com-style Game Review): Great is now an "only
 * good move" in a still-competitive position rather than the port's flat 150cp
 * best-vs-2nd gap (which fired on every forced recapture once the report runs at
 * MultiPV 2). It requires the second-best line to drop at least a blunder's
 * worth of winning chances, the mover not to be already winning, and the move
 * not to be an obvious material-winning capture. Rules 1, 4-5 (Book, Best, Miss)
 * and the Excellent/Good ranking are unchanged.
 */

import { type Chess, type Role, type SquareName, playUci, roleAt, seeCapture } from './chess';
import { type BookLookup, NoBook } from './book';
import { type AnalysisInfo, bestLine, evalPov, lineMove } from '../engine/types';
import { cpFromEval, winningChances } from './accuracy';

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
  greatOnlyMoveWc:     number;  // 2nd-best must drop >= this in winning chances => only move (GREAT)
  greatAlreadyWinning: number;  // mover-POV best eval before >= this => already winning, no GREAT
  brilliantMaxCpl:     number;  // near-best ceiling to still be BRILLIANT
  brilliantKeep:       number;  // mover-POV eval after move must stay >= this (not losing)
  brilliantAlreadyWinning: number; // mover-POV best eval before >= this => already winning, no BRILLIANT
  sacrificeMin:        number;  // net material the opponent can win back => a sacrifice
  missWin:             number;  // had at least this (mover POV) => was winning
  missKeep:            number;  // dropped below this => threw the win (MISS)
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  excellentMax:    20,
  goodMax:         50,
  inaccuracyMax:  100,
  mistakeMax:     250,
  greatOnlyMoveWc: 0.30, // every alternative would drop >= a blunder's worth of winning chances
  greatAlreadyWinning: 300, // already up ~a minor piece before the move => keeping it isn't "great"
  brilliantMaxCpl: 30,
  brilliantKeep:  -50,
  brilliantAlreadyWinning: 300, // already up ~a minor piece before the move => sacs aren't brilliant
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
 * Defender-aware sacrifice test: after the move, can the opponent actually win
 * material on the destination square?
 *
 * chess.com-parity divergence from the Python port's attack-only heuristic (see
 * the module header).  A static exchange evaluation on the destination — from
 * the opponent's perspective, since it is their turn after the move — measures
 * how much material the opponent nets by capturing there, accounting for our
 * defenders and the full recapture sequence.  A defended piece / equal trade /
 * recapture nets 0 and is NOT a sacrifice; a genuinely hanging piece nets its
 * value.  Subtracting what we grabbed on the move (`gained`) gives the net
 * material handed over; a real sacrifice hands over at least `sacrificeMin`
 * (which, being a minor-piece floor, also excludes mere pawn sacs — SEE on a
 * pawn can never reach it).
 *
 * Notes on edge cases:
 *   • En-passant: the captured pawn is not on the destination before the move,
 *     so `gained` = 0 (unchanged from the port).
 *   • Promotions: the destination holds the promoted piece after the move, so
 *     the SEE values the piece the opponent would actually capture.
 */
export function isSacrifice(
  posBefore:  Chess,
  uci:        string,
  thresholds?: Thresholds,
): boolean {
  const t = thresholds ?? DEFAULT_THRESHOLDS;
  // Columns 2–3 of any UCI string are the destination square ('e2e4' → 'e4', 'e7e8q' → 'e8').
  const dest = uci.slice(2, 4) as SquareName;

  // Material we grabbed by playing the move (captured piece on the destination, if any).
  const capturedRole = roleAt(posBefore, dest);
  const gained       = capturedRole !== undefined ? PIECE_VALUE[capturedRole] : 0;

  // After the move it is the opponent's turn; SEE tells us what they win back.
  const after        = playUci(posBefore, uci);
  const opponentWins = seeCapture(after, dest, PIECE_VALUE);

  return (opponentWins - gained) >= t.sacrificeMin;
}

// ─── isWinningOrEvenCapture ──────────────────────────────────────────────────

/**
 * An "obvious" material-winning capture: the move captures an enemy piece worth
 * at least as much as the moving piece and does not hand the material back (it
 * is not a sacrifice).  Recaptures and grabbing a hanging piece are obvious —
 * chess.com labels them Best, never Great, even when they are the only move.
 */
export function isWinningOrEvenCapture(
  posBefore: Chess,
  uci:       string,
  thresholds?: Thresholds,
): boolean {
  const t = thresholds ?? DEFAULT_THRESHOLDS;
  const capturedRole = roleAt(posBefore, uci.slice(2, 4) as SquareName);
  if (capturedRole === undefined) return false;   // not a capture
  const moverRole = roleAt(posBefore, uci.slice(0, 2) as SquareName);
  if (moverRole === undefined) return false;       // no piece on the from-square (shouldn't happen)
  return PIECE_VALUE[capturedRole] >= PIECE_VALUE[moverRole]
      && !isSacrifice(posBefore, uci, t);
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

  // Winning-chances gap from best to second-best line (mover POV) — the "only
  // move" signal for GREAT. Null when the engine reported a single line (MultiPV
  // 1). Using winning chances rather than raw cp auto-compresses decided
  // positions, so keeping a won game no longer looks like an only-move.
  let secondWcDrop: number | null = null;
  if (analysisBefore.lines.length >= 2) {
    const moverSign = moverWhite ? 1 : -1;
    const bestWc   = winningChances(cpFromEval(bestLineBefore.eval) * moverSign);
    const secondWc = winningChances(cpFromEval(analysisBefore.lines[1].eval) * moverSign);
    secondWcDrop = bestWc - secondWc;
  }

  // ── ordered classification rules (exact Python ordering) ─────────────────

  // 1. Book
  if (bk.containsMove(posBefore, uci)) {
    return { label: MoveClass.BOOK, cpl, isBest };
  }

  // 2. Brilliant (chess.com parity): a sound sacrifice — near-best, not losing
  //    afterwards, not already clearly winning beforehand, and the opponent can
  //    genuinely win material on the square (defender-aware SEE in isSacrifice,
  //    so defended pieces / equal trades / recaptures don't qualify).
  const nearBest          = cpl <= t.brilliantMaxCpl;
  const notLosingAfter    = playedMover >= t.brilliantKeep;
  const notAlreadyWinning = bestMover < t.brilliantAlreadyWinning;
  if (nearBest && notLosingAfter && notAlreadyWinning && isSacrifice(posBefore, uci, t)) {
    return { label: MoveClass.BRILLIANT, cpl, isBest };
  }

  // 3. Great (chess.com parity): the only good move in a still-competitive
  //    position — isBest, every alternative drops at least a blunder's worth of
  //    winning chances, you were not already winning, and it isn't an obvious
  //    material-winning capture (recaptures / hanging grabs are Best, not Great).
  if (
    isBest &&
    secondWcDrop !== null &&
    secondWcDrop >= t.greatOnlyMoveWc &&
    bestMover < t.greatAlreadyWinning &&
    !isWinningOrEvenCapture(posBefore, uci, t)
  ) {
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

  // ── Lichess ?!/?/?? via winning-chances drop (mover POV) ──────────────────
  const moverSign = moverWhite ? 1 : -1;
  const beforeEval = bestLineBefore.eval;   // position before, best play
  const afterEval  = afterBest.eval;        // position after the played move
  const prevWC = winningChances(cpFromEval(beforeEval) * moverSign);
  const curWC  = winningChances(cpFromEval(afterEval)  * moverSign);
  const delta  = prevWC - curWC;            // >0 = mover lost winning chances

  const mateInvolved = beforeEval.mate !== null || afterEval.mate !== null;
  if (mateInvolved) {
    // Lichess MateAdvice — grade how badly a mate-related blunder/inaccuracy scores.
    const prevCp = cpFromEval(beforeEval) * moverSign;
    const curCp  = cpFromEval(afterEval)  * moverSign;
    const mateCreated = afterEval.mate !== null && (afterEval.mate * moverSign) < 0; // now getting mated
    const mateLost    = beforeEval.mate !== null && (beforeEval.mate * moverSign) > 0 && afterEval.mate === null; // had mate, lost it
    if (mateCreated) {
      if (prevCp < -999) return { label: MoveClass.INACCURACY, cpl, isBest };
      if (prevCp < -700) return { label: MoveClass.MISTAKE,    cpl, isBest };
      return { label: MoveClass.BLUNDER, cpl, isBest };
    }
    if (mateLost) {
      if (curCp > 999) return { label: MoveClass.INACCURACY, cpl, isBest };
      if (curCp > 700) return { label: MoveClass.MISTAKE,    cpl, isBest };
      return { label: MoveClass.BLUNDER, cpl, isBest };
    }
    // Mate delayed / mate improved / both-mate — no negative judgement; fall to bands.
  } else {
    if (delta >= 0.30) return { label: MoveClass.BLUNDER,    cpl, isBest };
    if (delta >= 0.20) return { label: MoveClass.MISTAKE,    cpl, isBest };
    if (delta >= 0.10) return { label: MoveClass.INACCURACY, cpl, isBest };
  }

  // Not a negative judgement: rank by centipawn loss (Excellent/Good only).
  if (cpl <= t.excellentMax) return { label: MoveClass.EXCELLENT, cpl, isBest };
  return { label: MoveClass.GOOD, cpl, isBest };
}
