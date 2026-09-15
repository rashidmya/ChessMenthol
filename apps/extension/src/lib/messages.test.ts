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
  it('recognizes the position-request / no-position handshake shapes', () => {
    const req: ExtMessage = { kind: 'position-request' };
    const none: ExtMessage = { kind: 'no-position', boardPresent: true };
    expect(isPositionMessage(req)).toBe(false);
    expect(isPositionMessage(none)).toBe(false);
  });
  it('a capture request may carry the requesting window id', () => {
    const m: ExtMessage = { kind: 'capture-request', windowId: 7 };
    expect(m.kind).toBe('capture-request');
  });
});
