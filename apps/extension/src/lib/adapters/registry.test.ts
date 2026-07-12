import { describe, it, expect } from 'vitest';
import { adapterFor } from './registry';
import type { SiteAdapter } from './types';

describe('adapterFor', () => {
  it('returns the chess.com adapter for chess.com URLs', () => {
    const a = adapterFor('https://www.chess.com/game/live/123');
    expect(a?.site).toBe('chesscom');
  });
  it('returns the lichess adapter for lichess.org URLs', () => {
    const a = adapterFor('https://lichess.org/abcd1234');
    expect(a?.site).toBe('lichess');
  });
  it('returns null for an unknown site', () => {
    expect(adapterFor('https://example.com/')).toBeNull();
  });
});
