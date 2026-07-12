import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Board from '../components/Board.svelte';

describe('Board', () => {
  it('mounts a board container for a given fen', () => {
    render(Board, { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', orientation: 'white' });
    expect(screen.getByTestId('board')).toBeTruthy();
  });

  it('mounts with arrow and edit props without throwing', () => {
    render(Board, {
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      orientation: 'white', lines: [{ multipv: 1, scoreText: '+0.2', cp: 20, mate: null,
        pv: ['e2e4'], san: 'e4' }], showArrows: true, editing: false, selectedEditPiece: 'P',
    } as any);
    expect(screen.getByTestId('board')).toBeTruthy();
  });

  it('exposes setPlacement and accepts an onEdit prop without throwing', () => {
    const onEdit = () => {};
    const { component } = render(Board, {
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      orientation: 'white', editing: true, selectedEditPiece: 'P', onEdit,
    } as any);
    // setPlacement is a no-op when chessground failed to init (jsdom), but must exist and not throw.
    expect(typeof (component as any).setPlacement).toBe('function');
    (component as any).setPlacement('8/8/8/8/8/8/8/8');
  });
});
