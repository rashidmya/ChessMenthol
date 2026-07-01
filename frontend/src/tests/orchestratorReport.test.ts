import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../core/orchestrator';
import type { ServerFrame, StateFrame } from '../lib/types';

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
