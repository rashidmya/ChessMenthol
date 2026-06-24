import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { applyFrame, state, lastError, errorSeq } from '../lib/ws';

beforeEach(() => {
  state.set(null);
  lastError.set(null);
  errorSeq.set(0);
});

describe('applyFrame', () => {
  it('stores a state frame', () => {
    const frame = {
      type: 'state', fen: 'startpos', sideToMove: 'white', engineId: 'stockfish',
      analyzing: true, eval: { cp: 30, mate: null, text: '+0.30' }, depth: 12,
      lines: [], lastMove: null,
    } as const;
    applyFrame(frame as any);
    expect(get(state)?.eval?.text).toBe('+0.30');
    expect(get(lastError)).toBeNull();
  });

  it('stores an error frame without touching state', () => {
    applyFrame({ type: 'error', message: 'bad fen' } as any);
    expect(get(lastError)).toBe('bad fen');
    expect(get(state)).toBeNull();
  });

  it('bumps errorSeq on each error frame', () => {
    const before = get(errorSeq);
    applyFrame({ type: 'error', message: 'illegal move: e1e3' } as any);
    applyFrame({ type: 'error', message: 'illegal move: e1e3' } as any);
    expect(get(errorSeq)).toBe(before + 2);
  });
});
