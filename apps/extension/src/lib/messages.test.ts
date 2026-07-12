import { describe, it, expect } from 'vitest';
import { isPositionMessage, type ExtMessage } from './messages';

describe('message guards', () => {
  it('recognizes a position message', () => {
    const m: ExtMessage = { kind: 'position', fen: '8/8/8/8/8/8/8/8 w - - 0 1', orientation: 'white', turn: 'w', site: 'lichess' };
    expect(isPositionMessage(m)).toBe(true);
  });
  it('rejects other messages', () => {
    expect(isPositionMessage({ kind: 'capture-request' } as ExtMessage)).toBe(false);
    expect(isPositionMessage({} as ExtMessage)).toBe(false);
  });
});
