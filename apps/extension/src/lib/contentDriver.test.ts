import { describe, it, expect, vi } from 'vitest';
import { runContentDriver } from './contentDriver';
import type { SiteAdapter } from './adapters/types';
import type { PositionMessage, AdapterStatusMessage } from './messages';

type Sent = PositionMessage | AdapterStatusMessage;

function fakeAdapter(fen: string): SiteAdapter & { fire: () => void; observedEl: Element | null } {
  // NOTE: `current` is mutable (unlike the plan's literal snippet, which closed over
  // the fixed `fen` param) so that `fire()` can simulate a genuinely changed board —
  // with an unchanging FEN, the canonical dedupe-by-FEN driver (see contentDriver.ts /
  // Task 6 Step 3) would never emit a second message, which is what this test asserts.
  let current = fen;
  let cb: () => void = () => {};
  const el = document.createElement('div');
  const adapter = {
    site: 'lichess' as const,
    matches: () => true,
    readPosition: () => ({ fen: current, orientation: 'white' as const, turn: 'w' as const }),
    observe: (observedEl: Element, onChange: () => void) => { adapter.observedEl = observedEl; cb = onChange; return () => {}; },
    boardElement: () => el,
    fire: () => { current = '8/8/8/8/8/8/8/8 b - - 0 1'; cb(); },
    observedEl: null as Element | null,
  };
  return adapter;
}

describe('runContentDriver', () => {
  it('sends the initial position and again on each observed change', () => {
    const sent: Sent[] = [];
    const a = fakeAdapter('8/8/8/8/8/8/8/8 w - - 0 1');
    const stop = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'position', site: 'lichess', fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
    expect(a.observedEl).toBe(a.boardElement()); // driver passes boardElement() straight into observe()
    a.fire();
    expect(sent).toHaveLength(2);
    stop();
  });

  it('skips updates while the adapter reports an active interaction (piece selected)', () => {
    const sent: Sent[] = [];
    let interacting = false;
    let current = 'A';
    let cb: () => void = () => {};
    const el = document.createElement('div');
    const a: SiteAdapter = {
      site: 'chesscom',
      matches: () => true,
      readPosition: () => ({ fen: current, orientation: 'white', turn: 'w' }),
      observe: (_el, onChange) => { cb = onChange; return () => {}; },
      boardElement: () => el,
      interacting: () => interacting,
    };
    const stop = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);                 // initial 'A'
    interacting = true; current = 'B'; cb();      // selecting a piece -> skip despite FEN change
    expect(sent).toHaveLength(1);
    interacting = false; cb();                    // deselected -> clean read emits 'B'
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ kind: 'position', fen: 'B' });
    stop();
  });

  it('dedupes identical FENs and skips null reads', () => {
    const sent: Sent[] = [];
    let fen: string | null = 'aaa';
    let cb: () => void = () => {};
    const el = document.createElement('div');
    const a: SiteAdapter = {
      site: 'chesscom',
      matches: () => true,
      readPosition: () => (fen ? { fen, orientation: 'white', turn: 'w' } : null),
      observe: (_el, onChange) => { cb = onChange; return () => {}; },
      boardElement: () => el, // null read here means "unparsed", not "no board"
    };
    const stop = runContentDriver(a, (m) => sent.push(m));
    const positions = () => sent.filter((m) => m.kind === 'position');
    expect(positions()).toHaveLength(1);   // initial 'aaa'
    cb();                                  // same FEN -> deduped
    expect(positions()).toHaveLength(1);
    fen = null; cb();                      // null read -> no position sent
    expect(positions()).toHaveLength(1);
    fen = 'bbb'; cb();                     // changed -> sent
    expect(positions()).toHaveLength(2);
    stop();
  });
});

function fakeStatusAdapter(over: Partial<SiteAdapter>): SiteAdapter {
  return {
    site: 'chesscom',
    matches: () => true,
    readPosition: () => null,
    observe: () => () => {},
    boardElement: () => null,
    ...over,
  };
}

describe('contentDriver adapter-status', () => {
  it('emits adapter-status ok:false when a board is present but unreadable', () => {
    const sent: any[] = [];
    const el = document.createElement('div');
    runContentDriver(fakeStatusAdapter({ readPosition: () => null, boardElement: () => el }), (m) => sent.push(m));
    expect(sent).toContainEqual({ kind: 'adapter-status', site: 'chesscom', ok: false });
  });

  it('stays silent when no board element is present (not a chess page)', () => {
    const sent: any[] = [];
    const observe = vi.fn(() => () => {});
    runContentDriver(fakeStatusAdapter({ readPosition: () => null, boardElement: () => null, observe }), (m) => sent.push(m));
    expect(sent).toEqual([]);
    expect(observe).not.toHaveBeenCalled();
  });

  it('emits ok:true then the position when a read recovers', () => {
    const sent: any[] = [];
    let ok = false;
    const el = document.createElement('div');
    const adapter = fakeStatusAdapter({
      readPosition: () => (ok ? { fen: '8/8/8/8/8/8/8/8 w - - 0 1', orientation: 'white', turn: 'w' } : null),
      boardElement: () => el,
      observe: (_el, cb) => { (adapter as any)._cb = cb; return () => {}; },
    });
    runContentDriver(adapter, (m) => sent.push(m)); // first read: null -> ok:false
    ok = true; (adapter as any)._cb();               // recovery read
    const kinds = sent.map((m) => m.kind);
    expect(kinds).toEqual(['adapter-status', 'adapter-status', 'position']);
    expect(sent[1]).toEqual({ kind: 'adapter-status', site: 'chesscom', ok: true });
  });
});
