// @vitest-environment node
// frontend/src/tests/orchestrator.integration.test.ts
//
// Real stockfish.wasm driven through the Orchestrator: end-to-end gate for the
// make_move -> classify path. Uses the same engine-loading pattern as
// engine.integration.test.ts. ONE engine instance shared across tests.
// No try/catch: a load failure is a failing gate, never a silent skip.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import initEngine from 'stockfish';
import { Orchestrator } from '../core/orchestrator';
import type { UciEngine } from '../engine/engine';
import type { ServerFrame, StateFrame } from '../lib/types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const CLASS_LABELS = new Set([
  'best', 'great', 'excellent', 'good', 'brilliant',
  'inaccuracy', 'mistake', 'blunder', 'miss',
]);

// Adapt the stockfish Node engine (sendCommand + listener) to our UciEngine seam.
// Mirrors the adapter in engine.integration.test.ts verbatim.
function nodeAdapter(sf: any): UciEngine {
  return {
    send: (cmd: string) => sf.sendCommand(cmd),
    onLine: (cb: (line: string) => void) => {
      sf.listener = (data: string) => {
        for (const line of String(data).split('\n')) {
          const t = line.trim();
          if (t) cb(t);
        }
      };
    },
    dispose: () => { try { sf.terminate?.(); } catch { /* ignore */ } },
  };
}

/**
 * Poll `frames` (by reference) for a new StateFrame satisfying `predicate`.
 * Captures `frames.length` at call time and scans only frames added after that
 * point, so pre-existing frames are never spuriously matched.
 */
function waitForFrame(
  frames: ServerFrame[],
  predicate: (f: StateFrame) => boolean,
  timeoutMs = 30_000,
): Promise<StateFrame> {
  return new Promise((resolve, reject) => {
    let idx = frames.length;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      clearInterval(interval);
      reject(new Error(
        `waitForFrame timed out after ${timeoutMs}ms (${frames.length} frames total)`,
      ));
    }, timeoutMs);
    const interval = setInterval(() => {
      if (done) return;
      while (idx < frames.length) {
        const f = frames[idx++];
        if (f.type === 'state' && predicate(f as StateFrame)) {
          done = true;
          clearInterval(interval);
          clearTimeout(timer);
          resolve(f as StateFrame);
          return;
        }
      }
    }, 50);
  });
}

describe('real stockfish.wasm via Orchestrator (classify integration)', () => {
  let engine: UciEngine;

  beforeAll(async () => {
    // No try/catch: a load failure must surface as a failing gate, not a skip.
    const sf = await (initEngine as unknown as (p: string) => Promise<any>)('lite-single');
    engine = nodeAdapter(sf);
    await new Promise<void>((resolve) => {
      engine.onLine((l) => { if (l === 'uciok') resolve(); });
      engine.send('uci');
    });
  }, 30_000);

  afterAll(() => { engine?.dispose(); });

  it('classifies e2e4 end-to-end through the Orchestrator at depth >= 8', async () => {
    const frames: ServerFrame[] = [];
    // Omit sessionFactory: the default factory builds a real AnalysisSession
    // around the shared engine. The engine has no select/configure methods, so
    // the lazy-select branch inside _restart() is simply skipped.
    const orch = new Orchestrator(
      (f) => frames.push(f),
      { engine, analysisEnabled: true },
    );

    // Depth-limited (no movetime cap) so the classify gate at depth >= 8 fires
    // from depth progress, not from a wall-clock timeout racing the engine.
    orch.handle({ type: 'set_options', depth: 12, movetime: null });

    // Start pre-move analysis on the start position.
    orch.handle({ type: 'set_fen', fen: START_FEN });

    // Wait until the engine has emitted at least one real line so _lastAnalysis
    // holds a valid best move (required for the classify gate in _onUpdate).
    await waitForFrame(frames, (f) => f.eval !== null && f.depth >= 1, 20_000);

    // make_move captures _lastAnalysis as the "before" snapshot into _pending,
    // then starts the post-e4 position search.
    orch.handle({ type: 'make_move', uci: 'e2e4' });

    // Wait for the AFTER-position search to reach CLASSIFY_MIN_DEPTH (8), which
    // triggers classification and emits a state frame with lastMove populated.
    const classified = await waitForFrame(frames, (f) => f.lastMove !== null, 30_000);

    // ─── assertions ──────────────────────────────────────────────────────────
    expect(classified.lastMove!.played.san).toBe('e4');
    expect(CLASS_LABELS.has(classified.lastMove!.classification.label)).toBe(true);
    // best.uci must be a valid UCI string (4 chars for normal, 5 with promotion).
    expect(classified.lastMove!.best.uci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    // Classification must also be reflected in moveList[0].
    expect(classified.moveList[0].classification).not.toBeNull();
    expect(classified.currentPly).toBe(1);
    expect(classified.gameOver).toBeNull();

    // Drain the in-flight search so the engine is quiet before afterAll disposes it.
    orch.handle({ type: 'stop' });
  }, 60_000);
});
