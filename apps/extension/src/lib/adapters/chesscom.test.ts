import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chesscomAdapter } from './chesscom';

// Note: `new URL('./relative', import.meta.url)` is NOT used here — this repo's
// vitest.config.ts sets `resolve.conditions: ['browser']`, which makes Vite apply
// its browser-target new-URL asset rewrite even under jsdom, turning the fixture
// path into an http://localhost URL and breaking node's fileURLToPath. Resolving
// the directory first sidesteps that rewrite.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '__fixtures__/chesscom-startpos.html'), 'utf8');

describe('chesscomAdapter.readPosition', () => {
  beforeEach(() => { document.body.innerHTML = fixture; });

  it('reads the position after 1.e4 with Black to move', () => {
    const pos = chesscomAdapter.readPosition();
    expect(pos).not.toBeNull();
    // placement + turn; ignore castling/ep/clock fields for the assertion
    expect(pos!.fen.split(' ').slice(0, 2).join(' ')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b',
    );
    expect(pos!.turn).toBe('b');
    expect(pos!.orientation).toBe('white');
  });

  it('returns null when there is no board', () => {
    document.body.innerHTML = '<div>no board here</div>';
    expect(chesscomAdapter.readPosition()).toBeNull();
  });
});
