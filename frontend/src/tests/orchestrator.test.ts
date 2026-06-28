/**
 * src/tests/orchestrator.test.ts
 *
 * Vitest port of the 36 NON-VISION pytest cases from tests/server/test_orchestrator.py.
 * The Python source is the parity spec — every assertion reproduces the Python's
 * expected value exactly. The 10 vision cases (capture_now / region / tracker
 * side-override) are SKIPPED — vision is Phase 2.
 *
 * Movetime parity note: Python stored seconds and asserted time_limit == 5.0 for
 * movetime=5000. Our TS stack keeps milliseconds throughout, so the equivalent
 * assertion is session.lastStartOpts.timeMs === 5000 (no x1000 anywhere).
 *
 * The doubles below mirror the Python FakeSession / OrderSession / RecordingEngine.
 */

import { describe, it, expect } from 'vitest';
import {
  Orchestrator,
  START_FEN,
  type SendCallback,
  type SessionFactory,
  type SessionLike,
  type OrchestratorEngine,
} from '../core/orchestrator';
import { posFromFen, fenOf } from '../core/chess';
import type { AnalysisInfo } from '../engine/types';
import type { StartOptions, SessionCallbacks } from '../engine/session';
import type { ServerFrame, StateFrame } from '../lib/types';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Mirrors the Python `_analysis(fen, cp, moves, depth=12)` fixture. */
function analysis(fen: string, cp: number, ucis: string[], depth = 12): AnalysisInfo {
  return { fen, depth, lines: [{ multipv: 1, eval: { cp, mate: null }, depth, pv: ucis }] };
}

/** Synchronous stand-in: start() immediately emits queued analyses (Python FakeSession). */
class FakeSession implements SessionLike {
  queue: AnalysisInfo[] = [];
  started = 0;
  stopped = 0;
  lastStartOpts: StartOptions | null = null;
  private readonly cb: SessionCallbacks;
  constructor(_engine: OrchestratorEngine, cb: SessionCallbacks) {
    this.cb = cb;
  }
  start(_fen: string, opts: StartOptions): void {
    this.started++;
    this.lastStartOpts = opts;
    for (const info of this.queue) this.cb.onUpdate(info);
    this.queue = [];
  }
  stop(): void {
    this.stopped++;
  }
  dispose(): void {
    this.stopped++;
  }
}

/**
 * Builder for an Orchestrator wired with a FakeSession. Mirrors the Python
 * `make_orchestrator` fixture: analysis defaults ON (most behaviour tests need
 * it); pass `analysisEnabled: false` for the off-by-default / disabled paths.
 */
function makeOrchestrator(
  opts: { analysisEnabled?: boolean; send?: SendCallback } = {},
): { orch: Orchestrator; frames: ServerFrame[]; session: FakeSession } {
  const analysisEnabled = opts.analysisEnabled ?? true;
  const ownFrames = opts.send === undefined;
  const frames: ServerFrame[] = [];
  let session!: FakeSession;
  const factory: SessionFactory = (engine, cb) => {
    session = new FakeSession(engine, cb);
    return session;
  };
  const sink: SendCallback = ownFrames ? (f) => frames.push(f) : (opts.send as SendCallback);
  const orch = new Orchestrator(sink, { engine: {}, sessionFactory: factory, analysisEnabled });
  return { orch, frames, session };
}

/** The most recent `state` frame (Python `[f for f in frames if f["type"]=="state"][-1]`). */
function lastState(frames: ServerFrame[]): StateFrame {
  const states = frames.filter((f): f is StateFrame => f.type === 'state');
  return states[states.length - 1];
}

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';

// Fool's Mate position: White is checkmated (Black won).
const FOOLS_MATE_FEN = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
// Position one ply before Fool's Mate: it is Black's move (Qh4#).
const PRE_MATE_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2';
// Stalemate: Black to move — king on h8, White queen on f7, White king on g6.
const STALEMATE_FEN = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';

const CLASS_LABELS = new Set([
  'best', 'great', 'excellent', 'good', 'brilliant', 'book',
  'inaccuracy', 'mistake', 'blunder', 'miss',
]);

// ─── core command behaviour ─────────────────────────────────────────────────────

describe('Orchestrator parity', () => {
  it('set_fen updates board and emits state', () => {
    const { orch, frames, session } = makeOrchestrator();
    const fen = AFTER_E4;
    session.queue = [analysis(fen, -10, ['e7e5'])];
    orch.handle({ type: 'set_fen', fen });
    const state = lastState(frames);
    expect(state.fen).toBe(fen);
    expect(state.sideToMove).toBe('black');
    expect(state.eval?.cp).toBe(-10);
  });

  it('invalid FEN emits error, no crash', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'set_fen', fen: 'not a fen' });
    expect(frames[frames.length - 1].type).toBe('error');
  });

  it('illegal move emits error', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'make_move', uci: 'e2e5' }); // illegal from start
    expect(frames.some((f) => f.type === 'error')).toBe(true);
  });

  it('make_move advances board', () => {
    const { orch, frames, session } = makeOrchestrator();
    session.queue = [analysis(AFTER_E4, 25, ['e7e5'])];
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    const state = lastState(frames);
    expect(state.fen.startsWith('rnbqkbnr/pppppppp/8/8/4P3')).toBe(true);
  });

  it('make_move classifies using prior analysis', () => {
    const { orch, frames, session } = makeOrchestrator();
    // Engine prefers d2d4; player plays e2e4 -> played != best (slot distinguishable).
    session.queue = [analysis(START_FEN, 30, ['d2d4'])];
    orch.handle({ type: 'set_fen', fen: START_FEN });
    session.queue = [analysis(AFTER_E4, 30, ['e7e5'], 12)];
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    const state = lastState(frames);
    expect(state.lastMove?.best.uci).toBe('d2d4');
    expect(state.lastMove?.best.san).toBe('d4');
    expect(state.lastMove?.played.san).toBe('e4');
    expect(CLASS_LABELS.has(state.lastMove!.classification.label)).toBe(true);
  });

  it('_onUpdate tolerates best line without a move', () => {
    // Pre-move analysis has a best line whose PV is empty (no move): classification
    // must be SKIPPED, the pending consumed, and nothing thrown.
    const { orch } = makeOrchestrator();
    const boardBefore = posFromFen(START_FEN);
    const brokenBefore: AnalysisInfo = {
      fen: START_FEN, depth: 18, lines: [{ multipv: 1, eval: { cp: 30, mate: null }, depth: 18, pv: [] }],
    };
    orch._pending = [boardBefore, 'e2e4', brokenBefore, 0];
    const goodAfter = analysis(AFTER_E4, -30, ['e7e5'], 12);
    expect(() => orch._onUpdate(goodAfter)).not.toThrow();
    expect(orch._lastMove).toBeNull(); // classification skipped, not bogus
    expect(orch._pending).toBeNull(); // consumed, won't retry forever
  });

  it('set_turn white/black', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'set_turn', white: false });
    expect(lastState(frames).sideToMove).toBe('black');
  });

  it('set_engine restarts session', () => {
    const { orch, frames, session } = makeOrchestrator();
    const before = session.started;
    orch.handle({ type: 'set_engine', id: 'stockfish_lite' });
    const state = lastState(frames);
    expect(state.engineId).toBe('stockfish_lite');
    expect(session.started).toBeGreaterThan(before);
  });

  it('make_move stops session before mutating board', () => {
    const log: Array<[string, string]> = [];
    let orchRef!: Orchestrator;

    class OrderSession implements SessionLike {
      constructor(_engine: OrchestratorEngine, _cb: SessionCallbacks) {}
      start(fen: string, _opts: StartOptions): void {
        log.push(['start', fen]);
      }
      stop(): void {
        // record the orchestrator's board AT THE MOMENT stop() is called
        log.push(['stop', fenOf(orchRef._board)]);
      }
      dispose(): void {}
    }

    const factory: SessionFactory = (engine, cb) => new OrderSession(engine, cb);
    const orch = new Orchestrator(() => {}, { engine: {}, sessionFactory: factory, analysisEnabled: true });
    orchRef = orch;
    orch.handle({ type: 'make_move', uci: 'e2e4' });

    // stopped while the board was still the pre-move (start) position
    expect(log).toContainEqual(['stop', START_FEN]);
    const stopI = log.findIndex((e) => e[0] === 'stop' && e[1] === START_FEN);
    const startIndices = log.map((e, i) => (e[0] === 'start' ? i : -1)).filter((i) => i >= 0);
    expect(startIndices.length).toBeGreaterThan(0);
    const lastStart = startIndices[startIndices.length - 1];
    expect(lastStart).toBeGreaterThan(stopI); // (re)started afterwards
    expect(log[lastStart][1]).not.toBe(START_FEN); // on the post-move position
  });

  it('stop command emits idle state frame', () => {
    const { orch, frames, session } = makeOrchestrator();
    orch.handle({ type: 'set_fen', fen: START_FEN });
    expect(lastState(frames).analyzing).toBe(true);
    orch.handle({ type: 'stop' });
    expect(lastState(frames).analyzing).toBe(false);
    expect(session.stopped).toBeGreaterThanOrEqual(1);
  });

  it('illegal move re-emits state so client can revert', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'make_move', uci: 'e2e5' }); // illegal from start
    const types = frames.map((f) => f.type);
    expect(types).toContain('error');
    expect(types).toContain('state');
    expect(lastState(frames).fen).toBe(START_FEN); // board unchanged
  });

  it('engine options persist across engine switch', () => {
    const factory: SessionFactory = (engine, cb) => new FakeSession(engine, cb);
    const engine = {
      selected: [] as string[],
      configured: [] as Array<[number | null, number | null]>,
      select(id: string) {
        this.selected.push(id);
      },
      configure(o: { threads: number | null; hash: number | null }) {
        this.configured.push([o.threads, o.hash]);
      },
    };
    const orch = new Orchestrator(() => {}, { engine, sessionFactory: factory, analysisEnabled: true });
    orch.handle({ type: 'set_options', threads: 4, hash: 128 });
    orch.handle({ type: 'set_engine', id: 'stockfish_lite' });
    expect(engine.selected.at(-1)).toBe('stockfish_lite');
    expect(engine.configured.at(-1)).toEqual([4, 128]); // user options re-applied
  });

  // ─── play_best ────────────────────────────────────────────────────────────

  it('play_best replays best using retained analysis', () => {
    const { orch, frames, session } = makeOrchestrator();
    session.queue = [analysis(START_FEN, 30, ['d2d4'])];
    orch.handle({ type: 'set_fen', fen: START_FEN });
    session.queue = [analysis(AFTER_E4, 30, ['e7e5'], 12)];
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    session.queue = [analysis(AFTER_D4, 25, ['g8f6'], 12)];
    orch.handle({ type: 'play_best', uci: 'd2d4' });
    const state = lastState(frames);
    expect(state.fen.startsWith('rnbqkbnr/pppppppp/8/8/3P4')).toBe(true); // d4 on board
    expect(state.lastMove?.classification.isBest).toBe(true);
    expect(state.lastMove?.best.uci).toBe('d2d4');
    expect(state.lastMove?.played.san).toBe('d4');
    // history/cursor regression-lock: play_best must REPLACE e4, not append.
    expect(state.currentPly).toBe(state.moveList.length); // cursor at the tip
    const sans = state.moveList.map((e) => e.san);
    expect(sans[sans.length - 1]).toBe('d4');
    expect(sans).not.toContain('e4');
    expect(state.moveList.length).toBe(1);
  });

  it('play_best noop without retained analysis', () => {
    const { orch, frames, session } = makeOrchestrator();
    session.queue = [analysis(START_FEN, 20, ['e2e4'])];
    orch.handle({ type: 'set_fen', fen: START_FEN });
    const stoppedBefore = session.stopped;
    orch.handle({ type: 'play_best', uci: 'e2e4' });
    const state = lastState(frames);
    expect(state.fen).toBe(START_FEN); // board unchanged
    expect(state.lastMove).toBeNull();
    expect(session.stopped).toBe(stoppedBefore); // no-op must not stop the session
  });

  // ─── explicit move history ───────────────────────────────────────────────

  it('make_move appends to move list', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    const state = lastState(frames);
    expect(state.currentPly).toBe(1);
    expect(state.moveList.length).toBe(1);
    const entry = state.moveList[0];
    expect(entry.ply).toBe(1);
    expect(entry.san).toBe('e4');
    expect(entry.uci).toBe('e2e4');
    expect(entry.classification).toBeNull(); // not yet classified (no deep analysis)
  });

  it('navigate from past truncates forward line', () => {
    // e4, e5, navigate back to ply 1, then c5 -> replaces e5 with c5.
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    orch.handle({ type: 'make_move', uci: 'e7e5' });
    orch.handle({ type: 'navigate', index: 1 });
    orch.handle({ type: 'make_move', uci: 'c7c5' }); // Sicilian; replaces e5
    const state = lastState(frames);
    expect(state.currentPly).toBe(2);
    expect(state.moveList.map((e) => e.san)).toEqual(['e4', 'c5']);
  });

  it('navigate clamps to zero', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    orch.handle({ type: 'navigate', index: 0 });
    const state = lastState(frames);
    expect(state.currentPly).toBe(0);
    expect(state.fen).toBe(START_FEN); // base position, no moves applied
  });

  it('navigate clamps to tip', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    orch.handle({ type: 'navigate', index: 99 }); // beyond tip (length 1)
    expect(lastState(frames).currentPly).toBe(1); // clamped to tip
  });

  it('reset clears history', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    orch.handle({ type: 'reset' });
    const state = lastState(frames);
    expect(state.moveList).toEqual([]);
    expect(state.currentPly).toBe(0);
    expect(state.fen).toBe(START_FEN);
  });

  it('set_fen starts a fresh line', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    orch.handle({ type: 'make_move', uci: 'e7e5' });
    orch.handle({ type: 'set_fen', fen: AFTER_E4 });
    const state = lastState(frames);
    expect(state.moveList).toEqual([]);
    expect(state.currentPly).toBe(0);
  });

  it('classification lands in moveList[0]', () => {
    const { orch, frames, session } = makeOrchestrator();
    session.queue = [analysis(START_FEN, 30, ['d2d4'])];
    orch.handle({ type: 'set_fen', fen: START_FEN });
    session.queue = [analysis(AFTER_E4, 30, ['e7e5'], 12)];
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    const state = lastState(frames);
    expect(state.lastMove).not.toBeNull();
    expect(state.moveList.length).toBe(1);
    const entry = state.moveList[0];
    expect(entry.classification).not.toBeNull();
    expect(CLASS_LABELS.has(entry.classification!.label)).toBe(true);
  });

  // ─── movetime / set_options ───────────────────────────────────────────────

  it('set_options movetime 5000 -> session timeMs 5000', () => {
    const { orch, session } = makeOrchestrator();
    orch.handle({ type: 'set_options', movetime: 5000 });
    expect(session.lastStartOpts?.timeMs).toBe(5000);
  });

  it('set_options movetime null -> session timeMs null', () => {
    const { orch, session } = makeOrchestrator();
    orch.handle({ type: 'set_options', movetime: null });
    expect(session.lastStartOpts?.timeMs).toBeNull();
  });

  it('set_options movetime 0 -> session timeMs null', () => {
    const { orch, session } = makeOrchestrator();
    orch.handle({ type: 'set_options', movetime: 0 });
    expect(session.lastStartOpts?.timeMs).toBeNull();
  });

  // ─── analysis on/off gate ─────────────────────────────────────────────────

  it('analysis is off by default', () => {
    const { orch, frames, session } = makeOrchestrator({ analysisEnabled: false });
    orch.handle({ type: 'set_fen', fen: START_FEN });
    const state = lastState(frames);
    expect(state.analysisEnabled).toBe(false);
    expect(state.analyzing).toBe(false);
    expect(session.started).toBe(0); // engine must not auto-start while off
  });

  it('disable analysis: state frame reflects disabled', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'set_analysis_enabled', enabled: false });
    const state = lastState(frames);
    expect(state.analysisEnabled).toBe(false);
    expect(state.analyzing).toBe(false);
  });

  it('make_move while disabled does not start analysis (move still recorded)', () => {
    const { orch, frames, session } = makeOrchestrator();
    orch.handle({ type: 'set_analysis_enabled', enabled: false });
    session.started = 0; // measure only starts triggered by the move
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    expect(session.started).toBe(0);
    const state = lastState(frames);
    expect(state.moveList.length).toBe(1);
    expect(state.currentPly).toBe(1);
  });

  it('re-enable analysis restarts session exactly once', () => {
    const { orch, session } = makeOrchestrator();
    orch.handle({ type: 'set_analysis_enabled', enabled: false });
    session.started = 0;
    orch.handle({ type: 'set_analysis_enabled', enabled: true });
    expect(session.started).toBe(1);
  });

  it('_onSearchDone sets analyzing false', () => {
    const { orch, frames } = makeOrchestrator();
    orch._analyzing = true;
    orch._onSearchDone();
    expect(lastState(frames).analyzing).toBe(false);
    expect(orch._analyzing).toBe(false);
  });

  // ─── play_best after navigation ───────────────────────────────────────────

  it('play_best works after navigation', () => {
    const { orch, frames, session } = makeOrchestrator();
    session.queue = [analysis(START_FEN, 30, ['d2d4'])];
    orch.handle({ type: 'set_fen', fen: START_FEN });
    session.queue = [analysis(AFTER_E4, 30, ['e7e5'], 12)];
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    orch.handle({ type: 'navigate', index: 0 }); // back to start
    orch.handle({ type: 'navigate', index: 1 }); // back to after e4
    session.queue = [analysis(AFTER_D4, 25, ['g8f6'], 12)];
    orch.handle({ type: 'play_best', uci: 'd2d4' });
    const state = lastState(frames);
    expect(state.fen.startsWith('rnbqkbnr/pppppppp/8/8/3P4')).toBe(true);
    expect(state.lastMove?.classification.isBest).toBe(true);
    expect(state.lastMove?.best.uci).toBe('d2d4');
    expect(state.lastMove?.played.san).toBe('d4');
    expect(state.currentPly).toBe(state.moveList.length);
    const sans = state.moveList.map((e) => e.san);
    expect(sans[sans.length - 1]).toBe('d4');
    expect(sans).not.toContain('e4');
    expect(state.moveList.length).toBe(1);
  });

  it('play_best noop at cursor 0 after navigation', () => {
    const { orch, frames, session } = makeOrchestrator();
    session.queue = [analysis(START_FEN, 30, ['d2d4'])];
    orch.handle({ type: 'set_fen', fen: START_FEN });
    session.queue = [analysis(AFTER_E4, 30, ['e7e5'], 12)];
    orch.handle({ type: 'make_move', uci: 'e2e4' });
    orch.handle({ type: 'navigate', index: 0 }); // back to start (cursor 0)
    const boardFenBefore = fenOf(orch._board);
    const historyLenBefore = orch._history.length;
    orch.handle({ type: 'play_best', uci: 'd2d4' });
    const state = lastState(frames);
    expect(state.fen).toBe(boardFenBefore); // board unchanged
    expect(orch._history.length).toBe(historyLenBefore); // e4 still there
    expect(state.currentPly).toBe(0); // cursor still at 0
  });

  // ─── game-over / terminal handling ────────────────────────────────────────

  it('set_fen to checkmate reports game over', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'set_fen', fen: FOOLS_MATE_FEN });
    const state = lastState(frames);
    expect(state.gameOver).toEqual({ result: '0-1', reason: 'checkmate' });
    expect(state.eval).toBeNull();
    expect(state.lines).toEqual([]);
    expect(state.analyzing).toBe(false);
  });

  it('set_fen to stalemate reports game over', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'set_fen', fen: STALEMATE_FEN });
    const state = lastState(frames);
    expect(state.gameOver).toEqual({ result: '1/2-1/2', reason: 'stalemate' });
    expect(state.analyzing).toBe(false);
  });

  it('make checkmating move classifies and reports game over', () => {
    const { orch, frames, session } = makeOrchestrator();
    // Engine's best here is Qh4# (d8h4) — same as the player's move -> BEST.
    session.queue = [analysis(PRE_MATE_FEN, -500, ['d8h4'], 12)];
    orch.handle({ type: 'set_fen', fen: PRE_MATE_FEN });
    const startsBeforeMove = session.started;

    orch.handle({ type: 'make_move', uci: 'd8h4' }); // Qh4#
    const state = lastState(frames);

    expect(state.gameOver).toEqual({ result: '0-1', reason: 'checkmate' });
    expect(state.analyzing).toBe(false);
    expect(state.eval).toBeNull();
    expect(state.lines).toEqual([]);
    // engine must NOT be restarted for a terminal position
    expect(session.started).toBe(startsBeforeMove);
    // mating move classified synchronously
    expect(state.lastMove).not.toBeNull();
    expect(state.lastMove?.played.san).toBe('Qh4#');
  });

  it('navigate to terminal ply restores game over and last move', () => {
    const { orch, frames, session } = makeOrchestrator();
    session.queue = [analysis(PRE_MATE_FEN, -500, ['d8h4'], 12)];
    orch.handle({ type: 'set_fen', fen: PRE_MATE_FEN });
    orch.handle({ type: 'make_move', uci: 'd8h4' });

    orch.handle({ type: 'navigate', index: 0 }); // pre-mate: game over clears
    expect(lastState(frames).gameOver).toBeNull();

    orch.handle({ type: 'navigate', index: 1 }); // mated: game over restored
    const state1 = lastState(frames);
    expect(state1.gameOver).toEqual({ result: '0-1', reason: 'checkmate' });
    expect(state1.lastMove).not.toBeNull(); // classified move survives navigation
  });

  it('non-terminal position has gameOver null', () => {
    const { orch, frames, session } = makeOrchestrator();
    session.queue = [analysis(START_FEN, 30, ['d2d4'])];
    orch.handle({ type: 'set_fen', fen: START_FEN });
    expect(lastState(frames).gameOver).toBeNull();
  });
});
