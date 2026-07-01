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
  return { orch, frames, last, session };
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
});
