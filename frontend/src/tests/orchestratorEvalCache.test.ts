import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../core/orchestrator';
import type { ServerFrame, StateFrame } from '../lib/types';
import type { AnalysisInfo } from '../engine/types';
import type { SessionCallbacks } from '../engine/session';

/**
 * A session that records every start(fen) and answers with a scripted eval at
 * depth 24 — equal to the report depth (`_reportDepth`), so it exactly clears the
 * `>=` skip-guard threshold, mirroring what the real batch produces (`go depth 24`).
 * The best-move PV is a legal pawn push for the side to move so lastMoveToDict never
 * throws while the batch stamps classifications.
 */
function makeCounting(depth = 24) {
  const starts: string[] = [];
  const factory = (_e: unknown, cb: SessionCallbacks) => ({
    start(fen: string) {
      starts.push(fen);
      const black = fen.split(' ')[1] === 'b';
      queueMicrotask(() => {
        cb.onUpdate({
          fen, depth,
          lines: [{ multipv: 1, eval: { cp: black ? -25 : 25, mate: null }, depth, pv: [black ? 'a7a6' : 'a2a3'] }],
        } as AnalysisInfo);
        cb.onDone?.();
      });
    },
    stop() {}, dispose() {},
  });
  return { starts, factory };
}

const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

describe('eval-cache skip-guard (Lichess-parity)', () => {
  it('navigating to a position the report already analyzed does NOT re-run the engine', async () => {
    const { starts, factory } = makeCounting(24);
    const frames: ServerFrame[] = [];
    const engine = { select: vi.fn(), setOption: vi.fn() };
    const orch = new Orchestrator((f) => frames.push(f), { engine, sessionFactory: factory, analysisEnabled: true });
    const last = () => frames.filter((f): f is StateFrame => f.type === 'state').at(-1)!;

    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' });
    orch.handle({ type: 'analyze_game' });
    await drain(); // run the batch → report; every position now cached at depth 24

    const before = starts.length;
    orch.handle({ type: 'navigate', index: 2 });
    await drain();

    expect(starts.length).toBe(before);   // skip-guard: no fresh engine search
    expect(last().analyzing).toBe(false); // and we are not searching
    expect(last().eval).not.toBeNull();   // the cached eval is displayed instead
    expect(last().depth).toBe(24);        // specifically the deep report eval, not a shallow re-search
  });

  it('still runs the engine for a position that has no cached eval (no false skip)', async () => {
    const { starts, factory } = makeCounting(24);
    const frames: ServerFrame[] = [];
    const engine = { select: vi.fn(), setOption: vi.fn() };
    const orch = new Orchestrator((f) => frames.push(f), { engine, sessionFactory: factory, analysisEnabled: true });

    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' });
    await drain(); // only the final (loaded) position gets a live eval cached — no batch

    const before = starts.length;
    orch.handle({ type: 'navigate', index: 1 }); // position after 1.e4 was never analyzed
    await drain();

    expect(starts.length).toBeGreaterThan(before); // cache miss ⇒ the engine still searches
  });

  it('invalidates the cache when the engine changes (never shows a foreign eval)', async () => {
    const { starts, factory } = makeCounting(24);
    const frames: ServerFrame[] = [];
    const engine = { select: vi.fn(), setOption: vi.fn() };
    const orch = new Orchestrator((f) => frames.push(f), { engine, sessionFactory: factory, analysisEnabled: true });

    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' });
    orch.handle({ type: 'analyze_game' });
    await drain(); // report → every position cached under the OLD engine

    orch.handle({ type: 'set_engine', id: 'other' }); // must drop the cache
    await drain(); // re-analyzes only the current (final) position under the new engine
    const before = starts.length;
    orch.handle({ type: 'navigate', index: 2 }); // was cached before, but the cache was cleared
    await drain();

    expect(starts.length).toBeGreaterThan(before); // fresh search under the new engine, not a stale hit
  });
});
