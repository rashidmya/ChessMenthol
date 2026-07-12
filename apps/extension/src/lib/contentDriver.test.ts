import { describe, it, expect, vi } from 'vitest';
import { runContentDriver } from './contentDriver';
import type { SiteAdapter } from './adapters/types';
import type { PositionMessage, AdapterStatusMessage } from './messages';

type Sent = PositionMessage | AdapterStatusMessage;

function fakeAdapter(fen: string): SiteAdapter & { fire: () => void } {
  // NOTE: `current` is mutable (unlike the plan's literal snippet, which closed over
  // the fixed `fen` param) so that `fire()` can simulate a genuinely changed board —
  // with an unchanging FEN, the canonical dedupe-by-FEN driver (see contentDriver.ts /
  // Task 6 Step 3) would never emit a second message, which is what this test asserts.
  let current = fen;
  let cb: () => void = () => {};
  return {
    site: 'lichess',
    matches: () => true,
    readPosition: () => ({ fen: current, orientation: 'white', turn: 'w' }),
    observe: (onChange) => { cb = onChange; return () => {}; },
    boardPresent: () => true,
    fire: () => { current = '8/8/8/8/8/8/8/8 b - - 0 1'; cb(); },
  };
}

describe('runContentDriver', () => {
  it('sends the initial position and again on each observed change', () => {
    const sent: Sent[] = [];
    const a = fakeAdapter('8/8/8/8/8/8/8/8 w - - 0 1');
    const stop = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'position', site: 'lichess', fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
    a.fire();
    expect(sent).toHaveLength(2);
    stop();
  });

  it('skips updates while the adapter reports an active interaction (piece selected)', () => {
    const sent: Sent[] = [];
    let interacting = false;
    let current = 'A';
    let cb: () => void = () => {};
    const a: SiteAdapter = {
      site: 'chesscom',
      matches: () => true,
      readPosition: () => ({ fen: current, orientation: 'white', turn: 'w' }),
      observe: (onChange) => { cb = onChange; return () => {}; },
      boardPresent: () => true,
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
    const a: SiteAdapter = {
      site: 'chesscom',
      matches: () => true,
      readPosition: () => (fen ? { fen, orientation: 'white', turn: 'w' } : null),
      observe: (onChange) => { cb = onChange; return () => {}; },
      boardPresent: () => false, // null read here means "no board", not "board but unparsed"
    };
    const stop = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);          // initial 'aaa'
    cb();                                  // same FEN -> deduped
    expect(sent).toHaveLength(1);
    fen = null; cb();                      // null read -> no send
    expect(sent).toHaveLength(1);
    fen = 'bbb'; cb();                     // changed -> sent
    expect(sent).toHaveLength(2);
    stop();
  });
});

function fakeStatusAdapter(over: Partial<SiteAdapter>): SiteAdapter {
  return {
    site: 'chesscom',
    matches: () => true,
    readPosition: () => null,
    observe: () => () => {},
    boardPresent: () => false,
    ...over,
  };
}

describe('contentDriver adapter-status', () => {
  it('emits adapter-status ok:false when a board is present but unreadable', () => {
    const sent: any[] = [];
    runContentDriver(fakeStatusAdapter({ readPosition: () => null, boardPresent: () => true }), (m) => sent.push(m));
    expect(sent).toContainEqual({ kind: 'adapter-status', site: 'chesscom', ok: false });
  });

  it('stays silent when no board element is present (not a chess page)', () => {
    const sent: any[] = [];
    runContentDriver(fakeStatusAdapter({ readPosition: () => null, boardPresent: () => false }), (m) => sent.push(m));
    expect(sent).toEqual([]);
  });

  it('emits ok:true then the position when a read recovers', () => {
    const sent: any[] = [];
    let ok = false;
    const adapter = fakeStatusAdapter({
      readPosition: () => (ok ? { fen: '8/8/8/8/8/8/8/8 w - - 0 1', orientation: 'white', turn: 'w' } : null),
      boardPresent: () => true,
      observe: (cb) => { (adapter as any)._cb = cb; return () => {}; },
    });
    runContentDriver(adapter, (m) => sent.push(m)); // first read: null -> ok:false
    ok = true; (adapter as any)._cb();               // recovery read
    const kinds = sent.map((m) => m.kind);
    expect(kinds).toEqual(['adapter-status', 'adapter-status', 'position']);
    expect(sent[1]).toEqual({ kind: 'adapter-status', site: 'chesscom', ok: true });
  });
});
