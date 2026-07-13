import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lichessAdapter } from './lichess';

// NOTE: vitest.config sets resolve.conditions ['browser'], which rewrites
// `new URL('./x', import.meta.url)` to an http URL and breaks fileURLToPath.
// Resolve the fixture dir once, then join — same pattern Task 2 used.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '__fixtures__', 'lichess-startpos.html'), 'utf8');

beforeEach(() => {
  document.body.innerHTML = fixture;
  // jsdom does no layout; give the board a real 512px width so squareSize = 64.
  const board = document.querySelector('cg-board')!;
  board.getBoundingClientRect = () => ({ width: 512, height: 512, top: 0, left: 0, right: 512, bottom: 512, x: 0, y: 0, toJSON() {} }) as DOMRect;
});

describe('lichessAdapter.readPosition', () => {
  it('reads the position after 1.e4 with Black to move', () => {
    const pos = lichessAdapter.readPosition();
    expect(pos).not.toBeNull();
    expect(pos!.fen.split(' ').slice(0, 2).join(' ')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b',
    );
    expect(pos!.turn).toBe('b');
    expect(pos!.orientation).toBe('white');
  });

  it('returns null with no board', () => {
    document.body.innerHTML = '<div>nothing</div>';
    expect(lichessAdapter.readPosition()).toBeNull();
  });

  it('reports interacting() while a piece is selected or its destinations are shown', () => {
    expect(lichessAdapter.interacting!()).toBe(false);
    document.querySelector('cg-board')!.insertAdjacentHTML('beforeend',
      '<square class="selected" style="transform: translate(64px, 448px);"></square>' +
      '<square class="move-dest" style="transform: translate(64px, 320px);"></square>');
    expect(lichessAdapter.interacting!()).toBe(true);
  });
});
