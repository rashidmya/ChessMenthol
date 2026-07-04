import { describe, it, expect, vi } from 'vitest';
import { runContentDriver } from './contentDriver';
import type { SiteAdapter } from './adapters/types';
import type { PositionMessage } from './messages';

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
    fire: () => { current = '8/8/8/8/8/8/8/8 b - - 0 1'; cb(); },
  };
}

describe('runContentDriver', () => {
  it('sends the initial position and again on each observed change', () => {
    const sent: PositionMessage[] = [];
    const a = fakeAdapter('8/8/8/8/8/8/8/8 w - - 0 1');
    const stop = runContentDriver(a, (m) => sent.push(m));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'position', site: 'lichess', fen: '8/8/8/8/8/8/8/8 w - - 0 1' });
    a.fire();
    expect(sent).toHaveLength(2);
    stop();
  });

  it('dedupes identical FENs and skips null reads', () => {
    const sent: PositionMessage[] = [];
    let fen: string | null = 'aaa';
    let cb: () => void = () => {};
    const a: SiteAdapter = {
      site: 'chesscom',
      matches: () => true,
      readPosition: () => (fen ? { fen, orientation: 'white', turn: 'w' } : null),
      observe: (onChange) => { cb = onChange; return () => {}; },
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
