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

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  Orchestrator,
  START_FEN,
  type SendCallback,
  type SessionFactory,
  type SessionLike,
  type OrchestratorEngine,
  type VisionTrackerLike,
} from '../core/orchestrator';
import { posFromFen, fenOf } from '../core/chess';
import { getOverrides } from '../lib/engineOptions';
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
  beforeEach(() => localStorage.clear());

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
    // set_engine always restarts the session, even when the id is unchanged.
    orch.handle({ type: 'set_engine', id: 'stockfish' });
    const state = lastState(frames);
    expect(state.engineId).toBe('stockfish');
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

  it('set_engine_option stores override and forwards to started engine', () => {
    let fakeSession!: FakeSession;
    const setOptionSpy = vi.fn();
    const engine: OrchestratorEngine = { select: vi.fn(), setOption: setOptionSpy };
    const factory: SessionFactory = (e, cb) => { fakeSession = new FakeSession(e, cb); return fakeSession; };
    const orch = new Orchestrator(() => {}, { engine, sessionFactory: factory, analysisEnabled: true });
    // Mark engine as started so setOption is forwarded to the engine immediately.
    orch._engineStarted = true;
    const engineId = orch._engineId;
    const startsBefore = fakeSession.started;
    orch.handle({ type: 'set_engine_option', name: 'MultiPV', value: '3' });
    expect(setOptionSpy).toHaveBeenCalledWith('MultiPV', '3');
    expect(getOverrides(engineId)).toMatchObject({ MultiPV: '3' });
    expect(fakeSession.started).toBeGreaterThan(startsBefore); // analysis restarted
  });

  it('reset_engine_options clears stored overrides and restarts analysis', () => {
    const { orch, session } = makeOrchestrator();
    const engineId = orch._engineId;
    // Store an override first.
    orch.handle({ type: 'set_engine_option', name: 'MultiPV', value: '3' });
    expect(getOverrides(engineId)).toMatchObject({ MultiPV: '3' });
    const startsBefore = session.started;
    orch.handle({ type: 'reset_engine_options' });
    expect(getOverrides(engineId)).toEqual({});
    expect(session.started).toBeGreaterThan(startsBefore); // restarted
  });

  it('reset_engine_option clears a single override and restarts', () => {
    const { orch, session } = makeOrchestrator();
    const engineId = orch._engineId;
    orch.handle({ type: 'set_engine_option', name: 'MultiPV', value: '3' });
    orch.handle({ type: 'set_engine_option', name: 'Threads', value: '4' });
    const startsBefore = session.started;
    orch.handle({ type: 'reset_engine_option', name: 'MultiPV' });
    expect(getOverrides(engineId)).toEqual({ Threads: '4' }); // MultiPV gone, Threads kept
    expect(session.started).toBeGreaterThan(startsBefore); // restarted
  });

  it('set_engine_option button (no value) forwards to engine but is NOT persisted', () => {
    let fakeSession!: FakeSession;
    const setOptionSpy = vi.fn();
    const engine: OrchestratorEngine = { select: vi.fn(), setOption: setOptionSpy };
    const factory: SessionFactory = (e, cb) => { fakeSession = new FakeSession(e, cb); return fakeSession; };
    const orch = new Orchestrator(() => {}, { engine, sessionFactory: factory, analysisEnabled: true });
    orch._engineStarted = true; // so the button press is forwarded to the engine
    const engineId = orch._engineId;
    orch.handle({ type: 'set_engine_option', name: 'Clear Hash' }); // button: no value
    expect(setOptionSpy).toHaveBeenCalledWith('Clear Hash', undefined);
    expect(getOverrides(engineId)).toEqual({}); // buttons fire once, never stored
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

  // ─── depth gate boundary (CLASSIFY_MIN_DEPTH = 8) ────────────────────────

  it('depth gate: depth < 8 skips classify, depth >= 8 fires it', () => {
    const { orch } = makeOrchestrator();
    const boardBefore = posFromFen(START_FEN);
    // Valid pre-move analysis: engine preferred d4, player will play e4.
    const beforeAnalysis = analysis(START_FEN, 30, ['d2d4'], 12);
    orch._pending = [boardBefore, 'e2e4', beforeAnalysis, 0];

    // ── depth 5 (< 8): classify must NOT fire, _pending must survive ─────────
    const shallowAfter = analysis(AFTER_E4, -20, ['e7e5'], 5);
    orch._onUpdate(shallowAfter);
    expect(orch._lastMove).toBeNull();    // no classification yet
    expect(orch._pending).not.toBeNull(); // pending still queued (not consumed)

    // ── depth 10 (>= 8): classify must fire and _pending be consumed ─────────
    const deepAfter = analysis(AFTER_E4, -20, ['e7e5'], 10);
    orch._onUpdate(deepAfter);
    expect(orch._lastMove).not.toBeNull(); // classification fired
    expect(orch._pending).toBeNull();      // pending consumed
  });
});

describe('castling (regression: the board sends king-two-square UCI; make_move must accept it)', () => {
  // White K e1, rooks a1/h1, full castling rights, white to move.
  const CASTLE_FEN = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
  const lastState = (frames: ServerFrame[]) =>
    frames.filter((f): f is StateFrame => f.type === 'state').at(-1)!;

  it('make_move e1g1 castles kingside with no error and records O-O', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'set_fen', fen: CASTLE_FEN });
    orch.handle({ type: 'make_move', uci: 'e1g1' });
    expect(frames.some((f) => f.type === 'error')).toBe(false);
    const s = lastState(frames);
    expect(s.fen.split(' ')[0]).toBe('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R4RK1'); // king g1, rook f1
    expect(s.moveList).toHaveLength(1);
    expect(s.moveList[0].san).toBe('O-O');
    expect(s.currentPly).toBe(1);
  });

  it('make_move e1c1 castles queenside and records O-O-O', () => {
    const { orch, frames } = makeOrchestrator();
    orch.handle({ type: 'set_fen', fen: CASTLE_FEN });
    orch.handle({ type: 'make_move', uci: 'e1c1' });
    expect(frames.some((f) => f.type === 'error')).toBe(false);
    expect(lastState(frames).moveList[0].san).toBe('O-O-O');
  });
});

// ─── vision (Phase 2) ───────────────────────────────────────────────────────────
// Ports the vision-relevant test_orchestrator.py cases. The async handlers are
// fire-and-forget from handle(); `flush()` lets the microtask/timer queue drain
// before asserting on a state that an awaited capture/detect produced.

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Minimal engine the default session factory can build an AnalysisSession over. */
function fakeEngine(): OrchestratorEngine {
  return { onLine: () => {}, send: () => {}, dispose: () => {} };
}

/** A canned VisionTracker facade; override individual methods per test. */
function fakeTracker(over: Partial<VisionTrackerLike> = {}): VisionTrackerLike {
  return {
    detectPosition: async () => null,
    grabFullDesktop: async () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    setRegion: () => {},
    setSideOverride: () => {},
    setOrientationOverride: () => {},
    reset: () => {},
    ...over,
  };
}

describe('orchestrator — vision', () => {
  // jsdom has no OffscreenCanvas/ImageData, which the default region-shot encoder
  // uses. Stub them just for this suite so request_region_shot exercises the real
  // serialize path (the encoder's dimension math is unit-tested in serialize.test.ts).
  let savedOC: unknown;
  let savedID: unknown;
  beforeAll(() => {
    class FakeBlob { async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } }
    class FakeOffscreenCanvas {
      constructor(public width: number, public height: number) {}
      getContext() { return { putImageData() {}, drawImage() {} }; }
      async convertToBlob() { return new FakeBlob(); }
    }
    class FakeImageData {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    }
    const g = globalThis as Record<string, unknown>;
    savedOC = g.OffscreenCanvas;
    savedID = g.ImageData;
    g.OffscreenCanvas = FakeOffscreenCanvas;
    g.ImageData = FakeImageData;
  });
  afterAll(() => {
    const g = globalThis as Record<string, unknown>;
    g.OffscreenCanvas = savedOC;
    g.ImageData = savedID;
  });

  it('set_region validates, stores the region, and triggers a capture that applies a detected placement', async () => {
    const frames: ServerFrame[] = [];
    const tracker = fakeTracker({
      detectPosition: async () => ({
        fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
        isLegal: true,
        status: 'valid',
        lowConfidence: ['e4'],
        move: null,
        orientation: 'white_bottom',
        sideToMove: 'white',
      }),
    });
    const orch = new Orchestrator((f) => frames.push(f), { engine: fakeEngine(), tracker });
    orch.handle({ type: 'set_region', left: 10, top: 20, width: 100, height: 100 });
    await flush(); // let the async capture resolve
    const last = lastState(frames);
    expect(last.region).toEqual({ left: 10, top: 20, width: 100, height: 100 });
    expect(last.visionStatus).toBe('low_confidence');
    expect(last.lowConfidence).toEqual(['e4']);
    expect(last.detectedOrientation).toBe('white');
    // placement changed -> the detected FEN was applied to the working board
    expect(last.fen.split(' ')[0]).toBe('4k3/8/8/8/8/8/8/4K3');
  });

  it('set_region rejects a non-positive rectangle', () => {
    const frames: ServerFrame[] = [];
    const orch = new Orchestrator((f) => frames.push(f), { engine: fakeEngine(), tracker: fakeTracker() });
    orch.handle({ type: 'set_region', left: -1, top: 0, width: 0, height: 5 });
    expect(frames.at(-1)?.type).toBe('error');
  });

  it('capture_now with no board -> visionStatus no_board', async () => {
    const frames: ServerFrame[] = [];
    const orch = new Orchestrator((f) => frames.push(f), {
      engine: fakeEngine(),
      tracker: fakeTracker({ detectPosition: async () => null }),
    });
    orch.handle({ type: 'capture_now' });
    await flush();
    expect(lastState(frames).visionStatus).toBe('no_board');
  });

  it('request_region_shot emits a region_shot frame with the true dimensions', async () => {
    const frames: ServerFrame[] = [];
    const tracker = fakeTracker({
      grabFullDesktop: async () => ({ data: new Uint8ClampedArray(800 * 600 * 4), width: 800, height: 600 }),
    });
    const orch = new Orchestrator((f) => frames.push(f), { engine: fakeEngine(), tracker });
    orch.handle({ type: 'request_region_shot' });
    await flush();
    const last = frames.at(-1);
    expect(last?.type).toBe('region_shot');
    if (last && last.type === 'region_shot') {
      expect(last.width).toBe(800); // TRUE desktop width (not the downscaled encode)
    }
  });

  it('clear_region resets region + status and forwards to the tracker', () => {
    const frames: ServerFrame[] = [];
    const setRegion = vi.fn();
    const orch = new Orchestrator((f) => frames.push(f), {
      engine: fakeEngine(),
      tracker: fakeTracker({ setRegion }),
    });
    orch.handle({ type: 'clear_region' });
    const last = lastState(frames);
    expect(last.region).toBeNull();
    expect(last.visionStatus).toBe('idle');
    expect(setRegion).toHaveBeenCalledWith(null);
  });

  it('set_turn forwards a side override to the tracker', () => {
    const setSideOverride = vi.fn();
    const orch = new Orchestrator(() => {}, {
      engine: fakeEngine(),
      tracker: fakeTracker({ setSideOverride }),
    });
    orch.handle({ type: 'set_turn', white: false });
    expect(setSideOverride).toHaveBeenCalledWith(false);
  });

  it('no tracker injected -> vision commands re-emit state and never throw', async () => {
    const frames: ServerFrame[] = [];
    const orch = new Orchestrator((f) => frames.push(f), { engine: fakeEngine() });
    expect(() => orch.handle({ type: 'capture_now' })).not.toThrow();
    expect(() => orch.handle({ type: 'request_region_shot' })).not.toThrow();
    // valid set_region: its `void _captureNow()` hits the null-tracker re-emit branch
    expect(() => orch.handle({ type: 'set_region', left: 0, top: 0, width: 100, height: 100 })).not.toThrow();
    expect(() => orch.handle({ type: 'clear_region' })).not.toThrow();
    await flush();
    // every emitted frame is a benign state frame (never an error)
    expect(frames.every((f) => f.type === 'state')).toBe(true);
  });
});
