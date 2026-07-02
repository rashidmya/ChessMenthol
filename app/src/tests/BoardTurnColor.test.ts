import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

// Wrap the real chessground so we can read the instance Board.svelte creates.
const h = vi.hoisted(() => ({ cg: null as any }));
vi.mock('@lichess-org/chessground', async (orig) => {
  const real: any = await orig();
  return { Chessground: (el: any, cfg: any) => { h.cg = real.Chessground(el, cfg); return h.cg; } };
});

import Board from '../components/Board.svelte';

// after 1.e4 e5, white to move
const WHITE_TO_MOVE = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const props = (fen: string) => ({ fen, orientation: 'white', onMove: () => {} } as any);

// Regression for the "play in-app, opponent moves, Capture -> board frozen" bug.
// chessground's fen reader loads only the placement; it flips its internal
// turnColor solely when the USER drags. So an in-app move toggles turnColor, and a
// later capture (a fen change that is NOT a drag) must re-assert turnColor from the
// fen -- otherwise turnColor stays on the wrong side and chessground refuses to drag
// (it gates on `turnColor === piece.color`), even though the turn indicator is right.
describe('Board syncs chessground turnColor from the fen', () => {
  it('restores the side to move after a drag toggled turnColor (capture path)', async () => {
    const { rerender } = render(Board, props(START));
    expect(h.cg).toBeTruthy();

    // A real drag toggles chessground's turnColor (board.js: turnColor = opposite()).
    // cg.move() does not, so emulate the post-drag state.
    h.cg.state.turnColor = 'black';

    await rerender(props(WHITE_TO_MOVE)); // capture frame: white to move

    expect(h.cg.state.movable.color).toBe('white'); // turn indicator side
    expect(h.cg.state.turnColor).toBe('white');     // chessground must agree -> draggable
  });

  it('keeps turnColor consistent through the full play->opponent->capture sequence', async () => {
    const P1 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'; // after in-app e4
    const { rerender } = render(Board, props(START));

    h.cg.state.turnColor = 'black';        // user dragged white's move in-app
    await rerender(props(P1));             // make_move response: black to move
    expect(h.cg.state.turnColor).toBe('black');
    expect(h.cg.state.movable.color).toBe('black');

    await rerender(props(WHITE_TO_MOVE));  // capture response: white to move again
    expect(h.cg.state.turnColor).toBe('white');
    expect(h.cg.state.movable.color).toBe('white');
    expect(h.cg.state.movable.dests?.size ?? 0).toBeGreaterThan(0);
  });
});
