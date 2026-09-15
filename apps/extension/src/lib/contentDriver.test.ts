import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    const d = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'position', site: 'lichess', fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
    expect(a.observedEl).toBe(a.boardElement()); // driver passes boardElement() straight into observe()
    a.fire();
    expect(sent).toHaveLength(2);
    d.stop();
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
    const d = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);                 // initial 'A'
    interacting = true; current = 'B'; cb();      // selecting a piece -> skip despite FEN change
    expect(sent).toHaveLength(1);
    interacting = false; cb();                    // deselected -> clean read emits 'B'
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ kind: 'position', fen: 'B' });
    d.stop();
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
    const d = runContentDriver(a, (m) => sent.push(m));
    const positions = () => sent.filter((m) => m.kind === 'position');
    expect(positions()).toHaveLength(1);   // initial 'aaa'
    cb();                                  // same FEN -> deduped
    expect(positions()).toHaveLength(1);
    fen = null; cb();                      // null read -> no position sent
    expect(positions()).toHaveLength(1);
    fen = 'bbb'; cb();                     // changed -> sent
    expect(positions()).toHaveLength(2);
    d.stop();
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
    const d = runContentDriver(fakeStatusAdapter({ readPosition: () => null, boardElement: () => el }), (m) => sent.push(m));
    expect(sent).toContainEqual({ kind: 'adapter-status', site: 'chesscom', ok: false });
    d.stop();
  });

  it('stays silent when no board element is present (not a chess page)', () => {
    const sent: any[] = [];
    const observe = vi.fn(() => () => {});
    const d = runContentDriver(fakeStatusAdapter({ readPosition: () => null, boardElement: () => null, observe }), (m) => sent.push(m));
    expect(sent).toEqual([]);
    expect(observe).not.toHaveBeenCalled();
    d.stop();
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
    const d = runContentDriver(adapter, (m) => sent.push(m)); // first read: null -> ok:false
    ok = true; (adapter as any)._cb();               // recovery read
    const kinds = sent.map((m) => m.kind);
    expect(kinds).toEqual(['adapter-status', 'adapter-status', 'position']);
    expect(sent[1]).toEqual({ kind: 'adapter-status', site: 'chesscom', ok: true });
    d.stop();
  });
});

/** Adapter whose board element is controlled by the test (null until "rendered"). */
function lateAdapter(fen: string) {
  let el: Element | null = null;
  let current = fen;
  let cb: () => void = () => {};
  let unsubscribes = 0;
  let subscribes = 0;
  const a: SiteAdapter & {
    render: () => Element; replace: () => Element; remove: () => void;
    unsubscribes: () => number; subscribes: () => number;
    setFen: (f: string) => void; fire: () => void;
  } = {
    site: 'lichess',
    matches: () => true,
    readPosition: () => (el ? { fen: current, orientation: 'white', turn: 'w' } : null),
    boardElement: () => el,
    observe: (_el, onChange) => { subscribes++; cb = onChange; return () => { unsubscribes++; }; },
    render: () => { el = document.createElement('div'); document.body.appendChild(el); return el; },
    replace: () => { el?.remove(); el = document.createElement('div'); document.body.appendChild(el); return el; },
    remove: () => { el?.remove(); el = null; },
    unsubscribes: () => unsubscribes,
    subscribes: () => subscribes,
    setFen: (f) => { current = f; },
    fire: () => cb(),
  };
  return a;
}

/** Let the body MutationObserver flush (microtask) and the settle debounce fire. */
async function settle(): Promise<void> { await Promise.resolve(); vi.advanceTimersByTime(300); }

describe('contentDriver board acquisition', () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; });
  afterEach(() => vi.useRealTimers());

  it('attaches and emits when the board renders after the script started', async () => {
    const sent: Sent[] = [];
    const a = lateAdapter('8/8/8/8/8/8/8/8 w - - 0 1');
    const d = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toEqual([]);                       // nothing to read yet, nothing said
    a.render();
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'position', fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
    a.setFen('8/8/8/8/8/8/8/8 b - - 0 1'); a.fire(); // the per-board observer is live
    expect(sent).toHaveLength(2);
    d.stop();
  });

  it('re-attaches to a replaced board element (new game) and pushes its first read', async () => {
    const sent: Sent[] = [];
    const a = lateAdapter('X');
    a.render();
    const d = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);
    a.replace();                                    // same FEN on the new board
    await settle();
    expect(a.unsubscribes()).toBe(1);               // old board observer torn down
    expect(sent).toHaveLength(2);                   // dedupe reset: new board's first read is pushed
    d.stop();
    expect(a.unsubscribes()).toBe(2);
  });

  it('readNow() returns the current position or a no-position reply', () => {
    const a = lateAdapter('Y');
    const d = runContentDriver(a, () => {});
    expect(d.readNow()).toEqual({ kind: 'no-position', boardPresent: false });
    a.render();
    expect(d.readNow()).toMatchObject({ kind: 'position', site: 'lichess', fen: 'Y' });
    d.stop();
  });

  it('readNow() holds the last clean position while the user is mid-interaction', () => {
    const a = lateAdapter('Z');
    let interacting = false;
    a.interacting = () => interacting;
    a.render();
    const d = runContentDriver(a, () => {});        // initial read 'Z'
    interacting = true; a.setFen('POLLUTED');
    expect(d.readNow()).toMatchObject({ kind: 'position', fen: 'Z' });
    d.stop();
  });

  it('tears down when the board disappears and re-attaches when it returns', async () => {
    const sent: Sent[] = [];
    const a = lateAdapter('W');
    a.render();
    const d = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);
    a.remove();
    await settle();
    expect(a.unsubscribes()).toBe(1);
    expect(d.readNow()).toEqual({ kind: 'no-position', boardPresent: false });
    a.render();
    await settle();
    expect(sent).toHaveLength(2);                   // re-subscribed and pushed
    d.stop();
  });

  it('unrelated body churn with the same board does not re-emit or re-subscribe', async () => {
    const sent: Sent[] = [];
    const a = lateAdapter('V');
    a.render();
    const d = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);
    expect(a.subscribes()).toBe(1);
    for (let i = 0; i < 3; i++) document.body.appendChild(document.createElement('span'));
    await settle();
    expect(sent).toHaveLength(1);
    expect(a.unsubscribes()).toBe(0);
    expect(a.subscribes()).toBe(1);
    d.stop();
  });
});
