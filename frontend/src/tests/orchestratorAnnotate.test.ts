import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../core/orchestrator';
import type { ServerFrame, StateFrame } from '../lib/types';
import type { AnalysisInfo } from '../engine/types';
import type { SessionCallbacks } from '../engine/session';

// Session that answers each start(fen) with a scripted eval, depth 20.
// Returns a legal best-move pawn push for the side to move so lastMoveToDict
// never throws on an illegal PV (a2a3 is white's, a7a6 is black's).
function scriptedFactory(cpForFen: (fen: string) => number) {
  return (_e: unknown, cb: SessionCallbacks) => ({
    start(fen: string) {
      queueMicrotask(() => {
        const blackToMove = fen.split(' ')[1] === 'b';
        const bestMove = blackToMove ? 'a7a6' : 'a2a3';
        cb.onUpdate({ fen, depth: 20, lines: [{ multipv: 1, eval: { cp: cpForFen(fen), mate: null }, depth: 20, pv: [bestMove] }] } as AnalysisInfo);
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

describe('live annotation while navigating', () => {
  it('classifies the move you land on (jump) after the debounce', async () => {
    vi.useFakeTimers();
    const { orch, last } = mk();
    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' }); // 4 plies, none classified
    orch.handle({ type: 'navigate', index: 2 });                     // jump onto move 2 (…e5)
    expect(last().annotating).toBe(true);                            // hint shows immediately
    await vi.advanceTimersByTimeAsync(200);                          // fire the ~150ms debounce
    for (let i = 0; i < 30; i++) { await Promise.resolve(); }        // drain the before+after evals
    expect(last().moveList[1].classification).not.toBeNull();        // move 2 got a badge
    expect(last().annotating).toBe(false);
    vi.useRealTimers();
  });

  it('does nothing at index 0, when already classified, or when analysis is off', async () => {
    vi.useFakeTimers();
    // analysis OFF
    const framesOff: ServerFrame[] = [];
    const engineOff = { select: vi.fn(), setOption: vi.fn() };
    const off = new Orchestrator((f) => framesOff.push(f), { engine: engineOff, sessionFactory: scriptedFactory(() => 20), analysisEnabled: false });
    off.handle({ type: 'load_pgn', pgn: '1. e4 e5 *' });
    off.handle({ type: 'navigate', index: 1 });
    const lastOff = () => framesOff.filter((f): f is StateFrame => f.type === 'state').at(-1)!;
    expect(lastOff().annotating).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(lastOff().moveList[0].classification).toBeNull();

    // index 0 (base) with analysis ON -> nothing to annotate
    const { orch, last } = mk();
    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 *' });
    orch.handle({ type: 'navigate', index: 0 });
    expect(last().annotating).toBe(false);

    // already classified -> navigating back onto it does NOT re-annotate
    const { orch: o2, last: l2 } = mk();
    o2.handle({ type: 'load_pgn', pgn: '1. e4 e5 *' });
    for (let i = 0; i < 30; i++) { await Promise.resolve(); } // flush the live-analysis session
    o2.handle({ type: 'analyze_game' });                      // stamps per-ply classifications
    for (let i = 0; i < 30; i++) { await Promise.resolve(); } // run the batch to completion
    o2.handle({ type: 'navigate', index: 1 });               // move 1 is now classified
    expect(l2().annotating).toBe(false);
    vi.useRealTimers();
  });

  it('analyze_game cancels a pending before-pass (no stuck annotating, no batch corruption)', async () => {
    vi.useFakeTimers();
    const { orch, frames, last } = mk();
    orch.handle({ type: 'load_pgn', pgn: '1. e4 e5 2. Nf3 Nc6 *' }); // 4 plies, none classified
    orch.handle({ type: 'navigate', index: 2 });                     // annotating true, debounce scheduled
    expect(last().annotating).toBe(true);
    // Flush the stray live-analysis microtasks WITHOUT firing the debounce timer
    // (still pending) so the batch below starts from a clean session.
    for (let i = 0; i < 30; i++) { await Promise.resolve(); }
    expect(last().annotating).toBe(true);                            // still pending (timer not fired)
    orch.handle({ type: 'analyze_game' });                           // must cancel the timer + clear annotating
    expect(last().annotating).toBe(false);                          // (a) not stuck true — FAILS without the fix
    await vi.advanceTimersByTimeAsync(200);                          // the cancelled timer must NOT fire mid-batch
    for (let i = 0; i < 30; i++) { await Promise.resolve(); }        // drain the batch
    expect(last().annotating).toBe(false);                          // still false after the debounce window
    const rep = frames.find((f) => f.type === 'report');            // (b) batch completed cleanly into a report
    expect(rep).toBeDefined();
    if (rep && rep.type === 'report') expect(rep.report.plies).toHaveLength(4);
    vi.useRealTimers();
  });

  it('classifies a terminal (checkmate) move you navigate onto (synthetic after-eval)', async () => {
    vi.useFakeTimers();
    const { orch, last } = mk();
    orch.handle({ type: 'load_pgn', pgn: '1. f3 e5 2. g4 Qh4#' }); // 4 plies, final = mate (unclassified)
    // load leaves the cursor on the mating ply; the terminal board never starts the
    // engine (gameOver early-return), so re-navigating onto it triggers the before-pass
    // whose _finishAnnotate takes the terminal branch (synthesizes the after-eval).
    orch.handle({ type: 'navigate', index: 4 });                   // land on the mating move
    expect(last().annotating).toBe(true);
    await vi.advanceTimersByTimeAsync(200);                        // fire the debounce -> before-pass
    for (let i = 0; i < 30; i++) { await Promise.resolve(); }      // drain the before-eval
    expect(last().moveList[3].classification).not.toBeNull();      // mate move got a badge
    expect(last().annotating).toBe(false);
    vi.useRealTimers();
  });
});
