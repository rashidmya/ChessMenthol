/**
 * src/tests/engineClient.test.ts
 *
 * Tests for lib/engineClient.ts — the no-WebSocket Orchestrator client.
 *
 * Analysis is never enabled here, so loadStockfish() is never called.
 * jsdom has no WASM worker; keeping analysis off is the critical isolation boundary.
 *
 * The module exports a singleton orchestrator. Between tests we call
 * send({ type: 'reset' }) to return the orchestrator to the start position.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  applyFrame,
  state,
  lastError,
  errorSeq,
  connected,
  send,
} from '../lib/engineClient';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

beforeEach(() => {
  // Reset orchestrator + stores to start position; analysis stays OFF.
  send({ type: 'reset' });
});

// ─── applyFrame routing ────────────────────────────────────────────────────

describe('applyFrame routing', () => {
  it('error frame sets lastError and bumps errorSeq', () => {
    const seq0 = get(errorSeq);
    applyFrame({ type: 'error', message: 'bad fen' });
    expect(get(lastError)).toBe('bad fen');
    expect(get(errorSeq)).toBe(seq0 + 1);
  });

  it('two successive error frames bump errorSeq by 2', () => {
    const seq0 = get(errorSeq);
    applyFrame({ type: 'error', message: 'err1' });
    applyFrame({ type: 'error', message: 'err2' });
    expect(get(errorSeq)).toBe(seq0 + 2);
    expect(get(lastError)).toBe('err2');
  });

  it('state frame sets the state store', () => {
    const frame = {
      type: 'state' as const,
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      sideToMove: 'black' as const,
      engineId: 'stockfish',
      analyzing: false,
      eval: null, depth: 0, lines: [], lastMove: null,
      visionStatus: 'idle' as const, detectedOrientation: null,
      lowConfidence: [], region: null,
      moveList: [], currentPly: 0, analysisEnabled: false,
      movetime: 10000, reportProgress: null, gameOver: null, annotating: false,
    };
    applyFrame(frame);
    expect(get(state)?.fen).toBe(frame.fen);
    expect(get(state)?.sideToMove).toBe('black');
  });

  it('error frame does not overwrite the state store', () => {
    const stateBefore = get(state)?.fen;
    applyFrame({ type: 'error', message: 'something failed' });
    expect(get(state)?.fen).toBe(stateBefore);
  });
});

// ─── send integration ──────────────────────────────────────────────────────

describe('send integration', () => {
  it('make_move e2e4 → moveList has one entry with san "e4", currentPly 1', () => {
    send({ type: 'make_move', uci: 'e2e4' });
    const s = get(state);
    expect(s?.moveList).toHaveLength(1);
    expect(s?.moveList[0].san).toBe('e4');
    expect(s?.currentPly).toBe(1);
  });

  it('reset after make_move empties moveList and resets currentPly to 0', () => {
    send({ type: 'make_move', uci: 'e2e4' });
    send({ type: 'reset' });
    const s = get(state);
    expect(s?.moveList).toHaveLength(0);
    expect(s?.currentPly).toBe(0);
  });

  it('multiple moves accumulate in moveList', () => {
    send({ type: 'make_move', uci: 'e2e4' });
    send({ type: 'make_move', uci: 'e7e5' });
    const s = get(state);
    expect(s?.moveList).toHaveLength(2);
    expect(s?.moveList[0].san).toBe('e4');
    expect(s?.moveList[1].san).toBe('e5');
    expect(s?.currentPly).toBe(2);
  });

  it('illegal move bumps errorSeq, sets lastError, board FEN unchanged', () => {
    const seq0 = get(errorSeq);
    const fenBefore = get(state)?.fen;
    send({ type: 'make_move', uci: 'e2e5' }); // e5 is not a legal pawn move from e2
    expect(get(errorSeq)).toBe(seq0 + 1);
    expect(get(lastError)).toMatch(/illegal/i);
    expect(get(state)?.fen).toBe(fenBefore);
    expect(get(state)?.moveList).toHaveLength(0);
  });
});

// ─── connected store ───────────────────────────────────────────────────────

describe('connected store', () => {
  it('is always true (no socket)', () => {
    expect(get(connected)).toBe(true);
  });
});

// ─── initial / post-reset state ────────────────────────────────────────────

describe('initial state', () => {
  it('is the start position FEN', () => {
    expect(get(state)?.fen).toBe(START_FEN);
  });

  it('has analysisEnabled false', () => {
    expect(get(state)?.analysisEnabled).toBe(false);
  });

  it('has analyzing false', () => {
    expect(get(state)?.analyzing).toBe(false);
  });

  it('has empty moveList and currentPly 0', () => {
    const s = get(state);
    expect(s?.moveList).toHaveLength(0);
    expect(s?.currentPly).toBe(0);
  });
});
