import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../core/orchestrator';
import type { ServerFrame, StateFrame } from '../lib/types';
import type { AnalysisInfo } from '../engine/types';
import type { SessionCallbacks } from '../engine/session';

// Session that answers each start(fen) with a scripted eval (best move a2a3, depth 20).
function scriptedFactory(cpForFen: (fen: string) => number) {
  return (_e: unknown, cb: SessionCallbacks) => ({
    start(fen: string) {
      queueMicrotask(() => {
        cb.onUpdate({ fen, depth: 20, lines: [{ multipv: 1, eval: { cp: cpForFen(fen), mate: null }, depth: 20, pv: ['a2a3'] }] } as AnalysisInfo);
        cb.onDone?.();
      });
    },
    stop() {}, dispose() {},
  });
}
function mk(cpForFen: (fen: string) => number = () => 20) {
  const frames: ServerFrame[] = [];
  const engine = { select: vi.fn(), setOption: vi.fn() };
  const orch = new Orchestrator((f) => frames.push(f), { engine, sessionFactory: scriptedFactory(cpForFen), analysisEnabled: true });
  const states = () => frames.filter((f): f is StateFrame => f.type === 'state');
  const last = () => states().at(-1)!;
  return { orch, frames, states, last };
}
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe('annotating flag on live-played moves', () => {
  it('is true right after a move is played and false once it is classified', async () => {
    const { orch, states, last } = mk();
    orch.handle({ type: 'set_analysis_enabled', enabled: true }); // kick off analysis (constructor does not)
    await drain();                                   // start position analyzed -> beforeA available
    orch.handle({ type: 'make_move', uci: 'e2e4' }); // pending set
    expect(last().annotating).toBe(true);            // hint shows while classifying
    await drain();                                   // engine analyzes new pos -> classify
    expect(last().annotating).toBe(false);
    expect(last().moveList[0].classification).not.toBeNull();
    // sanity: at least one emitted frame carried annotating=true
    expect(states().some((s) => s.annotating)).toBe(true);
  });
});

describe('annotating never sticks true when the engine is silenced', () => {
  it('a move played while analysis is DISABLED does not strand annotating=true', async () => {
    const { orch, last } = mk();
    orch.handle({ type: 'set_analysis_enabled', enabled: true });
    await drain();                                     // populate _lastAnalysis
    orch.handle({ type: 'set_analysis_enabled', enabled: false });
    orch.handle({ type: 'make_move', uci: 'e2e4' });   // _playMove -> _restart disabled early-return
    expect(last().annotating).toBe(false);            // cleared centrally in _restart
    await drain();
    expect(last().annotating).toBe(false);            // and never resolves to true later
  });

  it('DISABLING analysis mid-annotation clears a pending classification', async () => {
    const { orch, last } = mk();
    orch.handle({ type: 'set_analysis_enabled', enabled: true });
    await drain();
    orch.handle({ type: 'make_move', uci: 'e2e4' });   // pending set, annotating true
    expect(last().annotating).toBe(true);
    orch.handle({ type: 'set_analysis_enabled', enabled: false }); // silence before it resolves
    expect(last().annotating).toBe(false);
    await drain();
    expect(last().annotating).toBe(false);
  });

  it('STOPPING analysis mid-annotation clears a pending classification', async () => {
    const { orch, last } = mk();
    orch.handle({ type: 'set_analysis_enabled', enabled: true });
    await drain();
    orch.handle({ type: 'make_move', uci: 'e2e4' });   // pending set, annotating true
    expect(last().annotating).toBe(true);
    orch.handle({ type: 'stop' });                     // stopAnalysis with _analysisEnabled still true
    expect(last().annotating).toBe(false);
    await drain();
    expect(last().annotating).toBe(false);
  });
});
