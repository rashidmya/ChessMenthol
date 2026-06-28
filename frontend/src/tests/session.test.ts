// frontend/src/tests/session.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AnalysisSession } from '../engine/session';
import type { UciEngine } from '../engine/engine';
import type { AnalysisInfo } from '../engine/types';

// Models real UCI ordering: `go` starts searching; `stop` ends the current search
// and emits its `bestmove`. The session synchronizes on that `bestmove` (drain),
// never on `readyok`, so the fake deliberately has no readyok at all.
class FakeEngine implements UciEngine {
  sent: string[] = [];
  private cb: ((line: string) => void) | null = null;
  private searching = false;
  send(cmd: string): void {
    this.sent.push(cmd);
    if (cmd === 'stop') {
      if (this.searching) { this.searching = false; this.emit('bestmove (none)'); }
    } else if (cmd.startsWith('go')) {
      this.searching = true;
    }
  }
  onLine(cb: (line: string) => void): void { this.cb = cb; }
  dispose(): void {}
  emit(line: string): void { this.cb?.(line); }
  last(): string { return this.sent[this.sent.length - 1]; }
}

// A fully manual fake: records commands and emits ONLY when the test calls emit().
// Unlike FakeEngine it does not auto-emit `bestmove` on `stop`, so a test can hold
// the session in the 'draining' phase and exercise drain-window edge cases.
class ManualEngine implements UciEngine {
  sent: string[] = [];
  private cb: ((line: string) => void) | null = null;
  send(cmd: string): void { this.sent.push(cmd); }
  onLine(cb: (line: string) => void): void { this.cb = cb; }
  dispose(): void {}
  emit(line: string): void { this.cb?.(line); }
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

function makeSession(eng: UciEngine, now: () => number, onUpdate: (a: AnalysisInfo) => void, onDone?: () => void) {
  return new AnalysisSession(eng, { onUpdate, onDone, throttleMs: 100, now });
}

describe('AnalysisSession launch', () => {
  it('launches with setoption MultiPV, position, then go (no isready barrier)', () => {
    const eng = new FakeEngine();
    const s = makeSession(eng, () => 0, () => {});
    s.start(START_FEN, { depth: 18, multipv: 3, timeMs: null });
    expect(eng.sent).toEqual([
      'setoption name MultiPV value 3',
      `position fen ${START_FEN}`,
      'go depth 18',
    ]);
  });
});

describe('AnalysisSession streaming + throttle', () => {
  it('emits on first info, throttles within the window, accumulates multipv', () => {
    const eng = new FakeEngine();
    let t = 0;
    const updates: AnalysisInfo[] = [];
    const s = makeSession(eng, () => t, (a) => updates.push(a));
    s.start(START_FEN, { depth: 30, multipv: 2, timeMs: null });

    t = 0;   eng.emit('info depth 10 multipv 1 score cp 20 pv e2e4');   // first -> emit
    t = 50;  eng.emit('info depth 10 multipv 2 score cp 10 pv d2d4');   // within window -> held
    t = 120; eng.emit('info depth 11 multipv 1 score cp 25 pv e2e4 e7e5'); // window passed -> emit

    expect(updates).toHaveLength(2);
    expect(updates[0].lines.map((l) => l.multipv)).toEqual([1]);
    expect(updates[1].lines.map((l) => l.multipv)).toEqual([1, 2]); // multipv 2 accumulated
    expect(updates[1].depth).toBe(11);
    expect(updates[1].lines[0].pv).toEqual(['e2e4', 'e7e5']);
  });

  it('flushes the final pending snapshot and fires onDone on bestmove', () => {
    const eng = new FakeEngine();
    let t = 0;
    const updates: AnalysisInfo[] = [];
    const done = vi.fn();
    const s = makeSession(eng, () => t, (a) => updates.push(a), done);
    s.start(START_FEN, { depth: 5, multipv: 1, timeMs: null });

    t = 0;  eng.emit('info depth 4 multipv 1 score cp 12 pv e2e4'); // emitted
    t = 10; eng.emit('info depth 5 multipv 1 score cp 15 pv e2e4'); // held (within window)
    eng.emit('bestmove e2e4');

    expect(updates).toHaveLength(2);          // first + flushed final
    expect(updates[1].depth).toBe(5);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('ignores info lines that carry no score', () => {
    const eng = new FakeEngine();
    const updates: AnalysisInfo[] = [];
    const s = makeSession(eng, () => 1000, (a) => updates.push(a));
    s.start(START_FEN, { depth: 5, multipv: 1, timeMs: null });
    eng.emit('info string hello');
    eng.emit('info depth 1 currmove e2e4 currmovenumber 1');
    expect(updates).toHaveLength(0);
  });
});

describe('AnalysisSession cancellation', () => {
  it('stop() drains the search, suppresses onDone, and ignores later bestmoves', () => {
    const eng = new FakeEngine();
    const updates: AnalysisInfo[] = [];
    const done = vi.fn();
    const s = makeSession(eng, () => 1000, (a) => updates.push(a), done);
    s.start(START_FEN, { depth: 30, multipv: 1, timeMs: null });
    eng.emit('info depth 10 multipv 1 score cp 5 pv e2e4');
    s.stop();                       // engine emits the stopped search's bestmove -> drained to idle
    expect(eng.last()).toBe('stop');
    eng.emit('bestmove e2e4');      // any further stale bestmove -> ignored (idle)
    expect(done).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1); // only the pre-stop emit
  });

  it('a superseding start() drains the old search (no onDone) and only the new search completes', () => {
    const eng = new FakeEngine();
    const done = vi.fn();
    const updates: AnalysisInfo[] = [];
    const s = makeSession(eng, () => 1000, (a) => updates.push(a), done);
    s.start(START_FEN, { depth: 30, multipv: 1, timeMs: null });
    eng.emit('info depth 10 multipv 1 score cp 5 pv e2e4');

    const otherFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    s.start(otherFen, { depth: 30, multipv: 1, timeMs: null });
    // start() sent `stop`; the engine's stale bestmove was drained and the new
    // search launched. The superseded search must NOT fire onDone.
    expect(eng.sent).toContain('stop');
    expect(eng.sent).toContain(`position fen ${otherFen}`);
    expect(done).not.toHaveBeenCalled();

    // The new search completing naturally fires onDone exactly once.
    eng.emit('bestmove d2d4');
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('AnalysisSession draining edge cases', () => {
  it('stop() while draining cancels the queued search and goes idle on bestmove', () => {
    const eng = new ManualEngine();
    const done = vi.fn();
    const s = makeSession(eng, () => 0, () => {}, done);
    s.start(START_FEN, { depth: 30, multipv: 1, timeMs: null }); // launch A (sends go)
    s.start(E4_FEN, { depth: 30, multipv: 1, timeMs: null });    // searching -> draining, queue B, send stop
    s.stop();                                                    // cancel the queued B, stay draining
    eng.emit('bestmove (none)');                                 // drain completes -> idle
    expect(done).not.toHaveBeenCalled();
    expect(eng.sent).not.toContain(`position fen ${E4_FEN}`);    // B was never launched
  });

  it('ignores info lines that arrive during the drain window', () => {
    const eng = new ManualEngine();
    const updates: AnalysisInfo[] = [];
    const s = makeSession(eng, () => 0, (a) => updates.push(a));
    s.start(START_FEN, { depth: 30, multipv: 1, timeMs: null });
    eng.emit('info depth 8 multipv 1 score cp 10 pv e2e4');      // searching -> update (1)
    s.start(E4_FEN, { depth: 30, multipv: 1, timeMs: null });    // -> draining (stop sent)
    eng.emit('info depth 9 multipv 1 score cp 99 pv h2h4');      // stale, during drain -> IGNORED
    expect(updates).toHaveLength(1);
    eng.emit('bestmove (none)');                                 // drain -> launch B (searching)
    eng.emit('info depth 5 multipv 1 score cp 7 pv g8f6');       // new search -> update (2)
    expect(updates).toHaveLength(2);
    expect(updates[1].fen).toBe(E4_FEN);
  });
});
