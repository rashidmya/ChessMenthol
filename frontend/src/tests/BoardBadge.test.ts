import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import BoardBadge from '../components/BoardBadge.svelte';

const lm = (label: string, uci: string) => ({
  classification: { label, cpl: 0, isBest: false },
  played: { san: 'Nf3', uci, evalText: '+0.2', pv: '' },
  best: { san: 'Nf3', uci, evalText: '+0.2', pv: '' },
});

describe('BoardBadge', () => {
  it('renders nothing without a last move', () => {
    const { queryByTestId } = render(BoardBadge, { lastMove: null, orientation: 'white' });
    expect(queryByTestId('board-badge')).toBeNull();
  });

  it('anchors the badge at the destination square top-right corner (white)', () => {
    const { getByTestId } = render(BoardBadge, { lastMove: lm('blunder', 'g1f3'), orientation: 'white' });
    const anchor = getByTestId('board-badge');
    // f3 → col 5, row 5 → top-right (6/8, 5/8) = 75%, 62.5%
    expect(anchor.style.left).toBe('75%');
    expect(anchor.style.top).toBe('62.5%');
  });

  it('flips with board orientation (black at bottom)', () => {
    const { getByTestId } = render(BoardBadge, { lastMove: lm('blunder', 'g1f3'), orientation: 'black' });
    const anchor = getByTestId('board-badge');
    // f3 black → col 2, row 2 → (3/8, 2/8) = 37.5%, 25%
    expect(anchor.style.left).toBe('37.5%');
    expect(anchor.style.top).toBe('25%');
  });

  it('renders nothing when the last move has no played uci', () => {
    const noUci = {
      classification: { label: 'blunder', cpl: 0, isBest: false },
      played: { san: 'Nf3', evalText: '+0.2', pv: '' },
      best: { san: 'Nf3', uci: 'g1f3', evalText: '+0.2', pv: '' },
    };
    const { queryByTestId } = render(BoardBadge, { lastMove: noUci, orientation: 'white' });
    expect(queryByTestId('board-badge')).toBeNull();
  });
});
