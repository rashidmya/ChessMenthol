import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LastMove from '../components/LastMove.svelte';

const notBest = {
  classification: { label: 'mistake', cpl: 276, isBest: false },
  played: { san: 'Nc3', evalText: '+5.03', pv: '16... bxc3' },
  best: { san: 'Nec5', uci: 'e6c5', evalText: '+2.27', pv: '16... O-O-O 17. Nd7 Bg3' },
};

const best = {
  classification: { label: 'best', cpl: 0, isBest: true },
  played: { san: 'Nec5', evalText: '+2.27', pv: '16... O-O-O 17. Nd7 Bg3' },
  best: { san: 'Nec5', uci: 'e6c5', evalText: '+2.27', pv: '16... O-O-O 17. Nd7 Bg3' },
};

// A brilliant move need not be the engine's #1, so it lands in the played row.
const brilliant = {
  classification: { label: 'brilliant', cpl: 8, isBest: false },
  played: { san: 'Bxh7+', evalText: '+1.20', pv: '17... Kxh7 18. Ng5+' },
  best: { san: 'Nf3', uci: 'g1f3', evalText: '+1.50', pv: '17. Nf3 Nc6' },
};

describe('LastMove', () => {
  it('shows played and best rows when best was not played', () => {
    render(LastMove, { lastMove: notBest, onPlayBest: () => {} });
    const played = screen.getByTestId('row-played');
    expect(played.textContent).toContain('+5.03');
    expect(played.textContent).toContain('Nc3 is a mistake');
    const playBest = screen.getByTestId('play-best');
    expect(playBest.textContent).toContain('+2.27');
    expect(playBest.textContent).toContain('Nec5 is best');
    // continuation rendered with figurine glyphs (knight glyph, no pawn glyph)
    expect(playBest.textContent).toContain('♞d7');
  });

  it('clicking the best row calls onPlayBest with the best uci', async () => {
    const spy = vi.fn();
    render(LastMove, { lastMove: notBest, onPlayBest: spy });
    await fireEvent.click(screen.getByTestId('play-best'));
    expect(spy).toHaveBeenCalledWith('e6c5');
  });

  it('shows a single best row (no button) when the best move was played', () => {
    render(LastMove, { lastMove: best, onPlayBest: () => {} });
    expect(screen.getByTestId('row-best').textContent).toContain('Nec5 is best');
    expect(screen.queryByTestId('play-best')).toBeNull();
    expect(screen.queryByTestId('row-played')).toBeNull();
  });

  it('renders nothing without a last move', () => {
    render(LastMove, { lastMove: null, onPlayBest: () => {} });
    expect(screen.queryByTestId('lastmove')).toBeNull();
  });

  it('shows a brilliant icon (not ✗) for a brilliant move that is not the engine top move', () => {
    render(LastMove, { lastMove: brilliant, onPlayBest: () => {} });
    const played = screen.getByTestId('row-played');
    expect(played.textContent).toContain('Bxh7+ is brilliant');
    expect(played.textContent).toContain('!!');
    expect(played.textContent).not.toContain('✗');
  });
});
