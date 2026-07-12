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

  // ── highlight / multi-board robustness ──────────────────────────────────────
  // chess.com `.piece square-FR` divs from "wpFR" codes. `extra` is raw HTML.
  function board(pieces: string[], extra = ''): string {
    const divs = pieces
      .map((c) => `<div class="piece ${c.slice(0, 2)} square-${c.slice(2)}"></div>`)
      .join('');
    return `<wc-chess-board class="board">${divs}${extra}</wc-chess-board>`;
  }
  const START_PIECES = [
    'wr11','wn21','wb31','wq41','wk51','wb61','wn71','wr81',
    'wp12','wp22','wp32','wp42','wp52','wp62','wp72','wp82',
    'bp17','bp27','bp37','bp47','bp57','bp67','bp77','bp87',
    'br18','bn28','bb38','bq48','bk58','bb68','bn78','br88',
  ];
  const E4_PIECES = START_PIECES.map((c) => (c === 'wp52' ? 'wp54' : c)); // e2 pawn -> e4
  const LASTMOVE = 'background-color: rgb(255, 255, 51);';
  const ANNOTATION = 'background-color: rgb(235, 97, 80);';
  const hl = (sq: string, style: string) => `<div class="highlight square-${sq}" style="${style}"></div>`;

  it('ignores a right-click annotation on an occupied square (turn from the real last move)', () => {
    document.body.innerHTML = board(E4_PIECES,
      hl('54', LASTMOVE) +    // e4 dest (occupied)
      hl('52', LASTMOVE) +    // e2 origin (empty)
      hl('12', ANNOTATION),   // a2 annotation (occupied)
    );
    expect(chesscomAdapter.readPosition()!.turn).toBe('b');
  });

  it('does not flip the turn for a lone highlighted occupied square (selection / premove)', () => {
    // Start position, no real move — only a selection highlight on the e2 pawn.
    document.body.innerHTML = board(START_PIECES, hl('52', 'background-color: rgb(255,170,0);'));
    expect(chesscomAdapter.readPosition()!.turn).toBe('w');
  });

  it('reads the main board when the page has multiple boards', () => {
    // A decoy mini-board (2 pieces) precedes the real board (full start position).
    const decoy = board(['wk51', 'bk58']);
    document.body.innerHTML = decoy + board(E4_PIECES);
    const pos = chesscomAdapter.readPosition();
    expect(pos!.fen.split(' ').slice(0, 2).join(' ')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w', // real board; no highlight => White
    );
  });
});
