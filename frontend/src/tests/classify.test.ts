/**
 * src/tests/classify.test.ts
 *
 * Vitest port of all 14 pytest cases in tests/analysis/test_classify.py.
 * The Python source is the parity spec; every assertion reproduces the Python's
 * expected value exactly.  Any divergence from the Python result is called out
 * in a comment rather than silently "fixed".
 */

import { describe, it, expect } from 'vitest';
import type { Chess } from '../core/chess';
import { fenOf, playUci, posFromFen, seeCapture } from '../core/chess';
import {
  DEFAULT_THRESHOLDS,
  MoveClass,
  PIECE_VALUE,
  classifyMove,
  isSacrifice,
} from '../core/classify';
import type { AnalysisInfo, Eval, Line } from '../engine/types';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Build an AnalysisInfo from compact fixture data.
 * lines: Array of [Eval, string[]] pairs, best-first.
 * Mirrors the Python mk_analysis helper.
 */
function mkAnalysis(
  fen:   string,
  lines: Array<[Eval, string[]]>,
  depth  = 20,
): AnalysisInfo {
  const lineObjs: Line[] = lines.map(([ev, pv], i) => ({
    multipv: i + 1,
    eval:    ev,
    depth,
    pv,
  }));
  return { fen, depth, lines: lineObjs };
}

/** Convenience: FEN of the starting position. */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Build (pos-before, afterFen) from the starting position by playing uci. */
function startAndAfter(uci: string): [Chess, string] {
  const pos   = posFromFen(START_FEN);
  const after = fenOf(playUci(pos, uci));
  return [pos, after];
}

/** eval({cp}) shorthand — mate is always null in our fixtures. */
function cp(centipawns: number): Eval {
  return { cp: centipawns, mate: null };
}

// ─── 1. MoveClass string stability ───────────────────────────────────────────

describe('MoveClass', () => {
  // Python: test_moveclass_values_are_stable_strings
  it('has stable lowercase string values', () => {
    expect(MoveClass.BRILLIANT).toBe('brilliant');
    expect(MoveClass.BLUNDER).toBe('blunder');
    // Spot-check the remaining labels while we're here.
    expect(MoveClass.GREAT).toBe('great');
    expect(MoveClass.BEST).toBe('best');
    expect(MoveClass.EXCELLENT).toBe('excellent');
    expect(MoveClass.GOOD).toBe('good');
    expect(MoveClass.INACCURACY).toBe('inaccuracy');
    expect(MoveClass.MISTAKE).toBe('mistake');
    expect(MoveClass.MISS).toBe('miss');
  });
});

// ─── 2. Thresholds sane defaults ─────────────────────────────────────────────

describe('DEFAULT_THRESHOLDS', () => {
  // Python: test_thresholds_have_sane_defaults
  it('CPL bands are ordered excellentMax < goodMax < inaccuracyMax < mistakeMax', () => {
    const t = DEFAULT_THRESHOLDS;
    expect(t.excellentMax).toBeLessThan(t.goodMax);
    expect(t.goodMax).toBeLessThan(t.inaccuracyMax);
    expect(t.inaccuracyMax).toBeLessThan(t.mistakeMax);
  });
});

// ─── 3–5. isSacrifice ────────────────────────────────────────────────────────

describe('isSacrifice', () => {
  // Python: test_is_sacrifice_true_when_queen_moves_to_pawn_attacked_square
  // Position: k7/8/6p1/8/8/8/8/3QK3 w - - 0 1
  // Black pawn on g6 attacks f5 and h5.  White queen d1→h5 (h5 empty, attacked).
  // gain=0, risked=900, (900-0=900) >= 200 → true.
  it('returns true when queen moves to a pawn-attacked empty square', () => {
    const pos = posFromFen('k7/8/6p1/8/8/8/8/3QK3 w - - 0 1');
    expect(isSacrifice(pos, 'd1h5')).toBe(true);
  });

  // Python: test_is_sacrifice_false_for_safe_queen_move
  // Same position: d1→d5; d5 is NOT attacked by black.
  it('returns false for a queen move to an unattacked square', () => {
    const pos = posFromFen('k7/8/6p1/8/8/8/8/3QK3 w - - 0 1');
    expect(isSacrifice(pos, 'd1d5')).toBe(false);
  });

  // Python: test_is_sacrifice_false_for_equal_capture
  // Position: k7/8/6p1/7q/8/8/8/3QK3 w - - 0 1  (black queen on h5)
  // Qxh5: gain=900 (black queen), risked=900 (white queen), (900-900=0) < 200 → false.
  it('returns false for an equal capture (Qxh5 with pawn guarding h5)', () => {
    const pos = posFromFen('k7/8/6p1/7q/8/8/8/3QK3 w - - 0 1');
    expect(isSacrifice(pos, 'd1h5')).toBe(false);
  });

  // chess.com-parity (defender-aware SEE): a DEFENDED piece on an attacked square
  // is NOT a sacrifice — the opponent cannot win material there.
  // Nb3-d4: d4 is attacked by the c6 knight but defended by the c3 pawn
  // (…Nxd4 cxd4 is an equal knight trade). Old attack-only heuristic said true.
  it('returns false for a defended piece on an attacked square (equal trade)', () => {
    const pos = posFromFen('7k/8/2n5/8/8/1NP5/8/4K3 w - - 0 1');
    expect(isSacrifice(pos, 'b3d4')).toBe(false);
  });

  // Same position without the c3 defender: the knight is truly hanging to the
  // c6 knight (opponent wins a whole knight) → a real sacrifice.
  it('returns true for an undefended (genuinely hanging) piece', () => {
    const pos = posFromFen('7k/8/2n5/8/8/1N6/8/4K3 w - - 0 1');
    expect(isSacrifice(pos, 'b3d4')).toBe(true);
  });
});

// ─── seeCapture (static exchange evaluation) ─────────────────────────────────

describe('seeCapture', () => {
  // Side to move captures the piece on the target square; result is the net
  // material the side to move wins through the optimal capture sequence.
  // (Knight on c6 attacks d4 — used as the recurring target square here.)

  it('wins the full value of an undefended piece', () => {
    // Black to move; white knight on d4 attacked only by the c6 knight.
    const pos = posFromFen('7k/8/2n5/8/3N4/8/8/4K3 b - - 0 1');
    expect(seeCapture(pos, 'd4', PIECE_VALUE)).toBe(PIECE_VALUE.knight);
  });

  it('is zero for a defended piece (equal trade)', () => {
    // Black to move; white knight d4 defended by the c3 pawn, attacked by c6
    // (…Nxd4 cxd4 is an even knight trade).
    const pos = posFromFen('7k/8/2n5/8/3N4/2P5/8/4K3 b - - 0 1');
    expect(seeCapture(pos, 'd4', PIECE_VALUE)).toBe(0);
  });

  it('returns 0 when the square is not attacked at all', () => {
    const pos = posFromFen('7k/8/8/8/3N4/8/8/4K3 b - - 0 1');
    expect(seeCapture(pos, 'd4', PIECE_VALUE)).toBe(0);
  });

  it('nets a pawn when two attackers overwhelm one defender (multi-ply)', () => {
    // Black knight c6 + rook d8 attack white knight d4; only the c3 pawn defends.
    // …Nxd4 cxd4 Rxd4 wins the pawn: knight−knight even, then rook takes pawn.
    const pos = posFromFen('3r3k/8/2n5/8/3N4/2P5/8/4K3 b - - 0 1');
    expect(seeCapture(pos, 'd4', PIECE_VALUE)).toBe(PIECE_VALUE.pawn);
  });
});

// ─── 6–14. classifyMove ──────────────────────────────────────────────────────

describe('classifyMove', () => {

  // Python: test_best_move_is_classified_best
  // before: [(cp=30, ['e2e4']), (cp=15, ['d2d4'])]; e4 played.
  // best_mover=30, played_mover=30, cpl=0, is_best=True → BEST
  it('classifies the best move as BEST', () => {
    const [pos, afterFen] = startAndAfter('e2e4');
    const before = mkAnalysis(START_FEN, [[cp(30), ['e2e4']], [cp(15), ['d2d4']]]);
    const after  = mkAnalysis(afterFen,  [[cp(30), ['e7e5']]]);
    const result = classifyMove(pos, 'e2e4', before, after);
    expect(result.label).toBe(MoveClass.BEST);
    expect(result.isBest).toBe(true);
    expect(result.cpl).toBe(0);
  });

  // Python: test_blunder_when_eval_collapses
  // before: [(cp=50, ['d2d4']), (cp=20, ['e2e4'])]; e4 played.
  // best_mover=50, played_mover=-300, cpl=350, is_best=False → BLUNDER
  it('classifies as BLUNDER when eval collapses (cpl 350)', () => {
    const [pos, afterFen] = startAndAfter('e2e4');
    const before = mkAnalysis(START_FEN, [[cp(50), ['d2d4']], [cp(20), ['e2e4']]]);
    const after  = mkAnalysis(afterFen,  [[cp(-300), ['e7e5']]]);
    const result = classifyMove(pos, 'e2e4', before, after);
    expect(result.label).toBe(MoveClass.BLUNDER);
    expect(result.isBest).toBe(false);
    expect(result.cpl).toBe(350);
  });

  // Python: test_inaccuracy_band
  // before: [(cp=90, ['d2d4']), (cp=20, ['e2e4'])]; e4 played.
  // best_mover=90, played_mover=10, cpl=80 (in 51–100 band) → INACCURACY
  it('classifies as INACCURACY in the 51–100 cpl band', () => {
    const [pos, afterFen] = startAndAfter('e2e4');
    const before = mkAnalysis(START_FEN, [[cp(90), ['d2d4']], [cp(20), ['e2e4']]]);
    const after  = mkAnalysis(afterFen,  [[cp(10), ['e7e5']]]);
    const result = classifyMove(pos, 'e2e4', before, after);
    expect(result.label).toBe(MoveClass.INACCURACY);
  });

  // Great is the only good move in a competitive position (winning-chances gap).
  // before: [(cp=50, ['e2e4']), (cp=-150, ['d2d4'])]; e4 played.
  // isBest, e4 is quiet, WC(+50)−WC(−150) ≈ 0.36 ≥ 0.30, bestMover 50 < 300 → GREAT
  it('classifies as GREAT when it is the only move that holds', () => {
    const [pos, afterFen] = startAndAfter('e2e4');
    const before = mkAnalysis(START_FEN, [[cp(50), ['e2e4']], [cp(-150), ['d2d4']]]);
    const after  = mkAnalysis(afterFen,  [[cp(50), ['e7e5']]]);
    const result = classifyMove(pos, 'e2e4', before, after);
    expect(result.label).toBe(MoveClass.GREAT);
  });

  // A quiet, non-capturing only-move in a non-winning position stays GREAT.
  it('keeps GREAT for a quiet only-move that is not already winning', () => {
    const [pos, afterFen] = startAndAfter('g1f3');
    const before = mkAnalysis(START_FEN, [[cp(40), ['g1f3']], [cp(-260), ['f2f3']]]);
    const after  = mkAnalysis(afterFen,  [[cp(40), ['e7e5']]]);
    const result = classifyMove(pos, 'g1f3', before, after);
    expect(result.label).toBe(MoveClass.GREAT);
  });

  // chess.com-parity GREAT regressions (over-detection the fix targets) ────────

  // Old rule fired on a flat 150cp gap regardless of how decided the game was.
  // Here the mover is already winning (+6.0) and the 2nd move is only ~1.7 worse
  // — a tiny winning-chances gap. That's a plain BEST, not GREAT.
  it('does NOT label GREAT when already winning and the WC gap is small', () => {
    const [pos, afterFen] = startAndAfter('e2e4');
    const before = mkAnalysis(START_FEN, [[cp(600), ['e2e4']], [cp(430), ['d2d4']]]);
    const after  = mkAnalysis(afterFen,  [[cp(600), ['e7e5']]]);
    const result = classifyMove(pos, 'e2e4', before, after);
    expect(result.label).not.toBe(MoveClass.GREAT);
    expect(result.label).toBe(MoveClass.BEST);
  });

  // Even a large WC gap does not earn GREAT when you were already crushing —
  // keeping a won game isn't a "great find". +5.0 best vs 0.0 alternative → BEST.
  it('does NOT label GREAT when already crushing (already-winning guard)', () => {
    const [pos, afterFen] = startAndAfter('e2e4');
    const before = mkAnalysis(START_FEN, [[cp(500), ['e2e4']], [cp(0), ['d2d4']]]);
    const after  = mkAnalysis(afterFen,  [[cp(500), ['e7e5']]]);
    const result = classifyMove(pos, 'e2e4', before, after);
    expect(result.label).not.toBe(MoveClass.GREAT);
  });

  // An obvious material-winning capture (here a rook recapture) is BEST, not
  // GREAT, even as the only move — chess.com never celebrates the obvious.
  it('does NOT label an obvious winning capture GREAT (recapture)', () => {
    const fen = '4k3/8/8/3r4/8/8/3R4/4K3 w - - 0 1';
    const pos = posFromFen(fen);
    const afterFen = fenOf(playUci(pos, 'd2d5'));
    const before = mkAnalysis(fen,      [[cp(30), ['d2d5']], [cp(-400), ['e1f1']]]);
    const after  = mkAnalysis(afterFen, [[cp(30), ['e8f8']]]);
    const result = classifyMove(pos, 'd2d5', before, after);
    expect(result.label).not.toBe(MoveClass.GREAT);
    expect(result.label).toBe(MoveClass.BEST);
  });

  // chess.com-parity brilliant: a sound sacrifice from a position that is NOT
  // already winning. Position: k7/8/6p1/8/8/8/8/3QK3 w - - 0 1; Qh5 offers the
  // queen to the g6 pawn (isSacrifice=true, the queen is genuinely hanging).
  // cpl=0, playedMover=120 >= −50 (not losing after), bestMover=120 < 300
  // (not already winning) → BRILLIANT.
  it('classifies a sound sacrifice as BRILLIANT', () => {
    const sacFen = 'k7/8/6p1/8/8/8/8/3QK3 w - - 0 1';
    const pos    = posFromFen(sacFen);
    const afterFen = fenOf(playUci(pos, 'd1h5'));
    const before = mkAnalysis(sacFen,  [[cp(120), ['d1h5']]]);
    const after  = mkAnalysis(afterFen, [[cp(120), ['a8b8']]]);
    const result = classifyMove(pos, 'd1h5', before, after);
    expect(result.label).toBe(MoveClass.BRILLIANT);
  });

  // chess.com-parity: a DEFENDED near-best piece is not a sacrifice, so it must
  // NOT be brilliant — this is the over-detection the fix targets.
  // Nb3-d4 is the engine's best move (cpl 0) and d4 is attacked, but the c3 pawn
  // defends it (…Nxd4 cxd4 is an equal trade) → plain BEST, never BRILLIANT.
  it('does NOT label a defended near-best move BRILLIANT (regression)', () => {
    const fen = '7k/8/2n5/8/8/1NP5/8/4K3 w - - 0 1';
    const pos = posFromFen(fen);
    const afterFen = fenOf(playUci(pos, 'b3d4'));
    const before = mkAnalysis(fen,      [[cp(120), ['b3d4']]]);
    const after  = mkAnalysis(afterFen, [[cp(120), ['c6d4']]]);
    const result = classifyMove(pos, 'b3d4', before, after);
    expect(result.label).not.toBe(MoveClass.BRILLIANT);
    expect(result.label).toBe(MoveClass.BEST);
  });

  // chess.com-parity: even a genuine sacrifice is NOT brilliant when the mover
  // was already clearly winning before it. Same undefended hanging-knight sac,
  // but bestMover=600 ≥ brilliantAlreadyWinning(300) → the guard skips brilliant.
  it('does NOT label a sacrifice BRILLIANT when already clearly winning', () => {
    const fen = '7k/8/2n5/8/8/1N6/8/4K3 w - - 0 1';
    const pos = posFromFen(fen);
    const afterFen = fenOf(playUci(pos, 'b3d4'));
    const before = mkAnalysis(fen,      [[cp(600), ['b3d4']]]);
    const after  = mkAnalysis(afterFen, [[cp(590), ['c6d4']]]);
    const result = classifyMove(pos, 'b3d4', before, after);
    expect(result.label).not.toBe(MoveClass.BRILLIANT);
  });

  // Python: test_missed_win
  // before: [(cp=400, ['d2d4']), (cp=60, ['e2e4'])]; e4 played.
  // best_mover=400 >= 200 (missWin), played_mover=30 < 100 (missKeep) → MISS
  it('labels a missed win as MISS', () => {
    const [pos, afterFen] = startAndAfter('e2e4');
    const before = mkAnalysis(START_FEN, [[cp(400), ['d2d4']], [cp(60), ['e2e4']]]);
    const after  = mkAnalysis(afterFen,  [[cp(30),  ['e7e5']]]);
    const result = classifyMove(pos, 'e2e4', before, after);
    expect(result.label).toBe(MoveClass.MISS);
  });

  // Python: test_mistake_band
  // before: [(cp=150, ['d2d4']), (cp=120, ['e2e4'])]; e4 played.
  // best_mover=150, played_mover=0, cpl=150 (in 101–250 band) → MISTAKE
  it('classifies as MISTAKE in the 101–250 cpl band', () => {
    const [pos, afterFen] = startAndAfter('e2e4');
    const before = mkAnalysis(START_FEN, [[cp(150), ['d2d4']], [cp(120), ['e2e4']]]);
    const after  = mkAnalysis(afterFen,  [[cp(0),   ['e7e5']]]);
    const result = classifyMove(pos, 'e2e4', before, after);
    expect(result.label).toBe(MoveClass.MISTAKE);
    expect(result.cpl).toBe(150);
  });

  // Python: test_black_to_move_blunder_uses_mover_pov
  // Black to move after 1.e4.  Evals are White POV.
  // before: [(cp=−20, ['c7c5']), (cp=−10, ['e7e5'])]; g8f6 played.
  // mover_white=false
  //   best_mover   = evalPov({cp:−20}, false) = −(−20) = 20
  //   played_mover = evalPov({cp:400}, false) = −400
  //   cpl = max(0, 20 − (−400)) = 420 → BLUNDER
  it('uses mover POV for black-to-move blunder (cpl 420)', () => {
    const blackFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const pos      = posFromFen(blackFen);
    const afterFen = fenOf(playUci(pos, 'g8f6'));
    const before   = mkAnalysis(blackFen, [[cp(-20), ['c7c5']], [cp(-10), ['e7e5']]]);
    const after    = mkAnalysis(afterFen,  [[cp(400), ['f1c4']]]);
    const result   = classifyMove(pos, 'g8f6', before, after);
    expect(result.isBest).toBe(false);
    expect(result.cpl).toBe(420);
    expect(result.label).toBe(MoveClass.BLUNDER);
  });
});
