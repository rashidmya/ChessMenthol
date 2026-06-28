/**
 * src/tests/serialize.test.ts
 *
 * Vitest port of 9 pytest cases from tests/server/test_serialize.py.
 * The Python source is the parity spec — every assertion reproduces the Python's
 * expected value exactly. test_region_shot_to_dict is skipped (Phase 2 / Tauri capture).
 *
 * Any divergence from the Python result must be called out explicitly rather than
 * silently "fixing" the assertion to match wrong output.
 *
 * NOTE: variationSan(black-to-move) produces '1...e5 2. Nf3' (no space after ...)
 * matching python-chess. chessops emits '1... e5' with a space; core/chess.ts
 * normalises it so the Python parity holds.
 */

import { describe, it, expect } from 'vitest';
import { posFromFen, playUci } from '../core/chess';
import type { Chess } from '../core/chess';
import { MoveClass } from '../core/classify';
import type { Classification } from '../core/classify';
import type { AnalysisInfo, Line } from '../engine/types';
import type { EvalDto, LineDto, ClassificationDto, LastMoveDto } from '../lib/types';
import {
  evalToDict,
  lineToDict,
  analysisToDict,
  classificationToDict,
  lastMoveToDict,
  PV_PLIES,
} from '../core/serialize';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Build a single Line from compact fixture data.
 * Mirrors the Python _line(cp, ucis, depth=20) helper.
 * pv is a list of UCI strings, already matching the TS Line.pv type.
 */
function mkLine(cpVal: number, ucis: string[], depth = 20): Line {
  return { multipv: 1, eval: { cp: cpVal, mate: null }, depth, pv: ucis };
}

// ─── 1. eval_to_dict cp & mate ───────────────────────────────────────────────

// Python: test_eval_to_dict_cp_and_mate
describe('evalToDict', () => {
  it('cp=140 → text "+1.40"', () => {
    const result: EvalDto = evalToDict({ cp: 140, mate: null });
    expect(result).toEqual({ cp: 140, mate: null, text: '+1.40' });
  });

  it('mate=3 → text "+M3"', () => {
    const result: EvalDto = evalToDict({ cp: null, mate: 3 });
    expect(result).toEqual({ cp: null, mate: 3, text: '+M3' });
  });
});

// ─── 2. line_to_dict includes uci & san ──────────────────────────────────────

// Python: test_line_to_dict_includes_uci_and_san
describe('lineToDict', () => {
  it('includes UCI pv and numbered SAN for white-to-move', () => {
    const pos: Chess = posFromFen(START_FEN);
    const line: Line = mkLine(20, ['e2e4', 'e7e5']);
    const result: LineDto = lineToDict(line, pos);
    expect(result.multipv).toBe(1);
    expect(result.scoreText).toBe('+0.20');
    expect(result.pv).toEqual(['e2e4', 'e7e5']);
    expect(result.san).toBe('1. e4 e5');
  });

  // Python: test_line_to_dict_empty_pv
  it('empty pv → pv [] and san ""', () => {
    const pos: Chess = posFromFen(START_FEN);
    const line: Line = { multipv: 1, eval: { cp: 0, mate: null }, depth: 1, pv: [] };
    const result: LineDto = lineToDict(line, pos);
    expect(result.pv).toEqual([]);
    expect(result.san).toBe('');
  });
});

// ─── 3. analysis_to_dict shape ───────────────────────────────────────────────

// Python: test_analysis_to_dict_shape
describe('analysisToDict', () => {
  it('includes depth, eval, and lines with pv', () => {
    const pos: Chess = posFromFen(START_FEN);
    const analysis: AnalysisInfo = {
      fen: START_FEN,
      depth: 18,
      lines: [mkLine(30, ['e2e4'])],
    };
    const result = analysisToDict(analysis, pos);
    expect(result.depth).toBe(18);
    expect(result.eval).toEqual({ cp: 30, mate: null, text: '+0.30' });
    expect(result.lines[0].pv).toEqual(['e2e4']);
  });

  // Python: test_analysis_to_dict_no_lines_has_null_eval
  it('no lines → null eval and lines []', () => {
    const pos: Chess = posFromFen(START_FEN);
    const result = analysisToDict({ fen: 'x', depth: 0, lines: [] }, pos);
    expect(result.eval).toBeNull();
    expect(result.lines).toEqual([]);
  });
});

// ─── 4. classification_to_dict ───────────────────────────────────────────────

// Python: test_classification_to_dict
describe('classificationToDict', () => {
  it('BRILLIANT/0/true → {label:"brilliant", cpl:0, isBest:true}', () => {
    const c: Classification = { label: MoveClass.BRILLIANT, cpl: 0, isBest: true };
    const result: ClassificationDto = classificationToDict(c);
    expect(result).toEqual({ label: 'brilliant', cpl: 0, isBest: true });
  });
});

// ─── 5. last_move_to_dict ────────────────────────────────────────────────────

// Python: test_last_move_to_dict_best_not_played
describe('lastMoveToDict', () => {
  it('best-not-played: played a3, best was e4 (mistake, cpl 276)', () => {
    const posBefore: Chess = posFromFen(START_FEN);
    const uci = 'a2a3';
    const posAfterA3: Chess = playUci(posBefore, uci);

    const before: AnalysisInfo = {
      fen: START_FEN,
      depth: 20,
      lines: [mkLine(227, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'])],
    };
    const after: AnalysisInfo = {
      fen: posAfterA3.toString?.() ?? '',
      depth: 20,
      lines: [mkLine(503, ['e7e5', 'g1f3'])],
    };
    const c: Classification = { label: MoveClass.MISTAKE, cpl: 276, isBest: false };

    const d: LastMoveDto = lastMoveToDict(c, posBefore, uci, before, after);

    expect(d.classification).toEqual({ label: 'mistake', cpl: 276, isBest: false });
    expect(d.played).toEqual({
      san: 'a3',
      uci: 'a2a3',
      evalText: '+5.03',
      pv: '1...e5 2. Nf3',
    });
    expect(d.best).toEqual({
      san: 'e4',
      uci: 'e2e4',
      evalText: '+2.27',
      pv: '1...e5 2. Nf3 Nc6 …',
    });
  });

  // Python: test_last_move_to_dict_best_played_single
  it('best-played: played e4, best was also e4 (best, cpl 0)', () => {
    const posBefore: Chess = posFromFen(START_FEN);
    const uci = 'e2e4';
    const posAfterE4: Chess = playUci(posBefore, uci);

    const before: AnalysisInfo = {
      fen: START_FEN,
      depth: 20,
      lines: [mkLine(30, ['e2e4', 'e7e5', 'g1f3'])],
    };
    const after: AnalysisInfo = {
      fen: posAfterE4.toString?.() ?? '',
      depth: 20,
      lines: [mkLine(28, ['e7e5', 'g1f3'])],
    };
    const c: Classification = { label: MoveClass.BEST, cpl: 0, isBest: true };

    const d: LastMoveDto = lastMoveToDict(c, posBefore, uci, before, after);

    expect(d.classification.isBest).toBe(true);
    expect(d.best).toEqual({
      san: 'e4',
      uci: 'e2e4',
      evalText: '+0.30',
      pv: '1...e5 2. Nf3',
    });
    expect(d.played.san).toBe('e4');
    expect(d.played.evalText).toBe('+0.28');
    expect(d.played.uci).toBe('e2e4');
    expect(d.played.pv).toBe('1...e5 2. Nf3');
  });

  // Python: test_last_move_to_dict_empty_continuation
  it('empty continuation: both pv fields are ""', () => {
    const posBefore: Chess = posFromFen(START_FEN);
    const uci = 'a2a3';
    const posAfterA3: Chess = playUci(posBefore, uci);

    const before: AnalysisInfo = {
      fen: START_FEN,
      depth: 20,
      lines: [mkLine(50, ['e2e4'])], // best move, no follow-up pv
    };
    const after: AnalysisInfo = {
      fen: posAfterA3.toString?.() ?? '',
      depth: 20,
      lines: [{ multipv: 1, eval: { cp: 40, mate: null }, depth: 20, pv: [] }],
    };
    const c: Classification = { label: MoveClass.INACCURACY, cpl: 10, isBest: false };

    const d: LastMoveDto = lastMoveToDict(c, posBefore, uci, before, after);

    expect(d.best.pv).toBe('');   // before.best.pv[1:] is empty (only move was e2e4)
    expect(d.played.pv).toBe(''); // after.best.pv is empty
  });
});

// sanity: PV_PLIES is 3 (matches Python constant)
describe('PV_PLIES', () => {
  it('is 3', () => {
    expect(PV_PLIES).toBe(3);
  });
});
