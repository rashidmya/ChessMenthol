import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../core/orchestrator';
import type { ServerFrame, StateFrame } from '../lib/types';
import type { AnalysisInfo } from '../engine/types';
import type { SessionCallbacks } from '../engine/session';

function makeOrch() {
  const frames: ServerFrame[] = [];
  const engine = { select: vi.fn(), setOption: vi.fn() };
  // A session stub that never calls back (analysis stays "started" but silent).
  const session = { start: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
  const orch = new Orchestrator((f) => frames.push(f), {
    engine,
    sessionFactory: () => session,
    analysisEnabled: false,
  });
  const last = () => frames.filter((f): f is StateFrame => f.type === 'state').at(-1)!;
  return { orch, frames, last, session, engine };
}

// A session that, on start(fen), immediately returns a scripted eval for that fen.
function scriptedFactory(evalForFen: (fen: string) => AnalysisInfo) {
  return (_engine: unknown, cb: SessionCallbacks) => ({
    start(fen: string, _opts?: unknown) {
      queueMicrotask(() => { cb.onUpdate(evalForFen(fen)); cb.onDone?.(); });
    },
    stop() {}, dispose() {},
  });
}

describe('load_pgn', () => {
  it('loads a PGN into the linear history', () => {
    const { orch, last } = makeOrch();
    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' });
    const s = last();
    expect(s.moveList.map((m) => m.uci)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(s.currentPly).toBe(4);
  });

  it('emits an error frame on invalid PGN and leaves history empty', () => {
    const { orch, frames } = makeOrch();
    orch.handle({ type: 'load_pgn', pgn: '1. e5 *' });
    expect(frames.some((f) => f.type === 'error')).toBe(true);
  });
});

describe('analyze_game', () => {
  it('produces a report with per-player accuracy, counts, and per-ply data', async () => {
    const frames: ServerFrame[] = [];
    const engine = { select: vi.fn(), setOption: vi.fn() };
    const cpByPlacement = (fen: string): number => {
      const placement = fen.split(' ')[0];
      if (placement.includes('QP')) return 900;      // arbitrary "White winning" position
      return 20;
    };
    const orch = new Orchestrator((f) => frames.push(f), {
      engine,
      sessionFactory: scriptedFactory((fen) => ({ fen, depth: 20, lines: [{ multipv: 1, eval: { cp: cpByPlacement(fen), mate: null }, depth: 20, pv: ['a2a3'] }] })),
      analysisEnabled: false,
    });

    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' });
    orch.handle({ type: 'analyze_game' });
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const rep = frames.find((f) => f.type === 'report');
    expect(rep).toBeDefined();
    if (rep && rep.type === 'report') {
      expect(rep.report.plies).toHaveLength(4);
      expect(rep.report.white.accuracy).toBeGreaterThan(0);
      expect(rep.report.plies[0].winWhite).toBeGreaterThan(0);
      // Prove the classify path actually ran for every ply. A systematic
      // classifyMove mis-wiring would be swallowed by the per-ply guard and
      // leave all classifications null, yet accuracy (from gameAccuracy, not
      // classify) would still be >0 — so accuracy alone can't catch it.
      expect(rep.report.plies[0].classification).not.toBeNull();
      expect(rep.report.plies.every((p) => p.classification !== null)).toBe(true);
    }
  });

  it('errors when there is no game to analyze', () => {
    const { orch, frames } = makeOrch();
    orch.handle({ type: 'analyze_game' });
    expect(frames.some((f) => f.type === 'error')).toBe(true);
  });

  it('cancel_analysis resets batch state and restores MultiPV', () => {
    const { orch, frames, last, engine } = makeOrch();
    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' });
    orch.handle({ type: 'analyze_game' });   // batch starts, waits (silent session)
    engine.setOption.mockClear();
    orch.handle({ type: 'cancel_analysis' });
    const s = last();
    expect(s.reportProgress).toBeNull();
    expect(s.analyzing).toBe(false);
    // MultiPV restored (no prior override in localStorage → back to '1').
    expect(engine.setOption).toHaveBeenCalledWith('MultiPV', '1');
    // no report was produced
    expect(frames.some((f) => f.type === 'report')).toBe(false);
  });

  it('stop during a running batch delegates to cancel (clears reportProgress)', () => {
    const { orch, frames, last } = makeOrch();
    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' });
    orch.handle({ type: 'analyze_game' }); // batch starts, waits (silent session)
    orch.handle({ type: 'stop' });
    const s = last();
    expect(s.reportProgress).toBeNull();
    expect(s.analyzing).toBe(false);
    expect(frames.some((f) => f.type === 'report')).toBe(false);
  });

  it('ignores board/nav mutations while a batch is running', () => {
    const { orch, frames, last } = makeOrch();
    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' });
    orch.handle({ type: 'analyze_game' });          // batch starts, waits (silent session)
    const before = last();
    expect(before.reportProgress).toEqual({ done: 0, total: 5 }); // base + 4 plies
    expect(before.moveList.map((m) => m.uci)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    orch.handle({ type: 'reset' });                 // would normally wipe history — must be ignored
    const after = last();
    expect(after.reportProgress).toEqual({ done: 0, total: 5 }); // batch untouched
    expect(after.moveList).toHaveLength(4);          // history intact
    expect(frames.some((f) => f.type === 'report')).toBe(false);
  });

  // ── player names (PGN headers → report; cleared for hand-edited games) ──────
  const scriptedEval = scriptedFactory((fen) => ({
    fen, depth: 20, lines: [{ multipv: 1, eval: { cp: 20, mate: null }, depth: 20, pv: ['a2a3'] }],
  }));
  function namedOrch() {
    const frames: ServerFrame[] = [];
    const engine = { select: vi.fn(), setOption: vi.fn() };
    const orch = new Orchestrator((f) => frames.push(f), {
      engine, sessionFactory: scriptedEval, analysisEnabled: false,
    });
    return { orch, frames };
  }
  const NAMED_PGN = '[White "Ada"]\n[Black "Bo"]\n\n1. e4 *';

  it('carries PGN White/Black header names into the report', async () => {
    const { orch, frames } = namedOrch();
    orch.handle({ type: 'load_pgn', pgn: NAMED_PGN });
    orch.handle({ type: 'analyze_game' });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const rep = frames.find((f) => f.type === 'report');
    expect(rep).toBeDefined();
    if (rep && rep.type === 'report') {
      expect(rep.report.whiteName).toBe('Ada');
      expect(rep.report.blackName).toBe('Bo');
    }
  });

  it('set_turn clears the stale PGN names for the resulting hand-edited game', async () => {
    const { orch, frames } = namedOrch();
    orch.handle({ type: 'load_pgn', pgn: NAMED_PGN });   // names captured (Ada/Bo)
    orch.handle({ type: 'set_turn', white: true });      // wipes history + must clear names
    orch.handle({ type: 'make_move', uci: 'g1f3' });     // rebuild a 1-move history
    orch.handle({ type: 'analyze_game' });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const rep = frames.find((f) => f.type === 'report');
    expect(rep).toBeDefined();
    if (rep && rep.type === 'report') {
      expect(rep.report.whiteName).toBeUndefined();
      expect(rep.report.blackName).toBeUndefined();
    }
  });

  it('synthesizes terminal-position eval (checkmate) without hanging', async () => {
    const frames: ServerFrame[] = [];
    const engine = { select: vi.fn(), setOption: vi.fn() };
    const orch = new Orchestrator((f) => frames.push(f), {
      engine,
      sessionFactory: scriptedFactory((fen) => ({ fen, depth: 20, lines: [{ multipv: 1, eval: { cp: 20, mate: null }, depth: 20, pv: ['a2a3'] }] })),
      analysisEnabled: false,
    });
    orch.handle({ type: 'load_pgn', pgn: '1. f3 e5 2. g4 Qh4#' });
    orch.handle({ type: 'analyze_game' });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const rep = frames.find((f) => f.type === 'report');
    expect(rep).toBeDefined();
    if (rep && rep.type === 'report') expect(rep.report.plies).toHaveLength(4);
  });
});
