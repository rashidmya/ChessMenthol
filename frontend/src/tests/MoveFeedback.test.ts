import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MoveFeedback from '../components/MoveFeedback.svelte';

describe('MoveFeedback evaluating hint', () => {
  it('shows "<san> was played" + Evaluating… when a badge is pending', () => {
    const { getByText, getByTestId } = render(MoveFeedback, {
      props: { lastMove: null, evaluating: { san: 'd3' } },
    });
    const box = getByTestId('evaluating');
    expect(box).toBeTruthy();
    // SAN is wrapped in .san (figurine font); assert via recursive textContent
    // since getByText only reads an element's direct text nodes.
    expect(box.querySelector('.san')?.textContent).toBe('d3');
    expect(box.textContent).toMatch(/d3 was played/);
    expect(getByText(/Evaluating/)).toBeTruthy();
  });

  it('renders nothing when neither lastMove nor evaluating is set', () => {
    const { queryByTestId } = render(MoveFeedback, { props: { lastMove: null, evaluating: null } });
    expect(queryByTestId('evaluating')).toBeNull();
    expect(queryByTestId('movefeedback')).toBeNull();
  });
});

const dto = {
  classification: { label: 'mistake', cpl: 276, isBest: false },
  played: { san: 'Nc3', uci: 'b1c3', evalText: '+5.03', pv: '16. Nxc3' },
  best: { san: 'Nec5', uci: 'd7c5', evalText: '+2.27', pv: '16. O-O-O' },
};

const bestDto = {
  classification: { label: 'best', cpl: 0, isBest: true },
  played: { san: 'Nec5', uci: 'e6c5', evalText: '+2.27', pv: '16. O-O-O' },
  best: { san: 'Nec5', uci: 'e6c5', evalText: '+2.27', pv: '16. O-O-O' },
};

describe('MoveFeedback', () => {
  it('shows played + best rows and plays best on click', async () => {
    const onPlayBest = vi.fn();
    const { getByTestId, getByText } = render(MoveFeedback, { lastMove: dto, onPlayBest });
    expect(getByText(/is a mistake/)).toBeTruthy();
    await fireEvent.click(getByTestId('play-best'));
    expect(onPlayBest).toHaveBeenCalledWith('d7c5');
  });

  it('renders nothing when lastMove is null', () => {
    const { queryByTestId } = render(MoveFeedback, { lastMove: null });
    expect(queryByTestId('movefeedback')).toBeNull();
  });

  it('shows a single row (no button) when the best move was played', () => {
    const { getByTestId, queryByTestId } = render(MoveFeedback, { lastMove: bestDto, onPlayBest: () => {} });
    expect(getByTestId('row-best').textContent).toContain('Nec5');
    expect(getByTestId('row-best').textContent).toContain('is best');
    expect(queryByTestId('play-best')).toBeNull();
  });

  it('wadv class on positive eval, badv on negative eval', () => {
    const { container } = render(MoveFeedback, { lastMove: dto, onPlayBest: () => {} });
    const badges = container.querySelectorAll('.badge');
    // played eval '+5.03' → wadv
    expect(badges[0].classList.contains('wadv')).toBe(true);
    // best eval '+2.27' → wadv
    expect(badges[1].classList.contains('wadv')).toBe(true);
  });

  it('badv class for negative eval text', () => {
    const negDto = {
      classification: { label: 'blunder', cpl: 500, isBest: false },
      played: { san: 'Ke2', uci: 'e1e2', evalText: '-3.20', pv: '' },
      best: { san: 'Nf3', uci: 'g1f3', evalText: '-0.10', pv: '' },
    };
    const { container } = render(MoveFeedback, { lastMove: negDto, onPlayBest: () => {} });
    const badges = container.querySelectorAll('.badge');
    expect(badges[0].classList.contains('badv')).toBe(true);
    expect(badges[1].classList.contains('badv')).toBe(true);
  });

  it('treats a 0.00 (equality) eval as wadv (White-better side)', () => {
    const zeroDto = {
      classification: { label: 'good', cpl: 0, isBest: false },
      played: { san: 'Nf3', uci: 'g1f3', evalText: '0.00', pv: '' },
      best: { san: 'e4', uci: 'e2e4', evalText: '+0.00', pv: '' },
    };
    const { container } = render(MoveFeedback, { lastMove: zeroDto, onPlayBest: () => {} });
    const badges = container.querySelectorAll('.badge');
    expect(badges[0].classList.contains('wadv')).toBe(true); // '0.00'
    expect(badges[1].classList.contains('wadv')).toBe(true); // '+0.00'
  });

  it('shows continuation PV as raw SAN (figurine glyphs are drawn by the CSS font)', () => {
    const { getByTestId } = render(MoveFeedback, { lastMove: dto, onPlayBest: () => {} });
    expect(getByTestId('row-played').textContent).toContain('Nxc3'); // raw letters
    expect(getByTestId('row-played').textContent).not.toContain('♞'); // no Unicode glyph
  });

  it('game-over: shows result badge, move san, no play-best button', () => {
    const bestLastMove = {
      classification: { label: 'best', cpl: 0, isBest: true },
      played: { san: 'Bh5#', uci: 'f1h5', evalText: '+M1', pv: '' },
      best: { san: 'Bh5#', uci: 'f1h5', evalText: '+M1', pv: '' },
    };
    const { getByTestId, queryByTestId } = render(MoveFeedback, {
      lastMove: bestLastMove,
      gameOver: { result: '1-0', reason: 'checkmate' },
    });
    // Shows the move san
    expect(getByTestId('row-gameover').textContent).toContain('Bh5#');
    // Shows 1-0 on the badge
    const badge = getByTestId('row-gameover').querySelector('.badge');
    expect(badge?.textContent).toBe('1-0');
    expect(badge?.classList.contains('wadv')).toBe(true);
    // No play-best button
    expect(queryByTestId('play-best')).toBeNull();
  });

  it('game-over with a non-best last move: single row, no button, shows san + result', () => {
    // The losing side blundered into mate: last move isBest:false → exercises the
    // label/'mist' branch (not the 'best' branch) of the game-over row.
    const mistakeLastMove = {
      classification: { label: 'mistake', cpl: 999, isBest: false },
      played: { san: 'Kg8', uci: 'h8g8', evalText: '-M1', pv: '' },
      best: { san: 'Qf8', uci: 'd8f8', evalText: '-M3', pv: '' },
    };
    const { getByTestId, queryByTestId } = render(MoveFeedback, {
      lastMove: mistakeLastMove,
      gameOver: { result: '0-1', reason: 'checkmate' },
    });
    const row = getByTestId('row-gameover');
    // Single non-button row, no play-best
    expect(queryByTestId('play-best')).toBeNull();
    // Shows the played san (not the best move)
    expect(row.textContent).toContain('Kg8');
    expect(row.textContent).not.toContain('Qf8');
    // Non-best branch: 'is a mistake' phrasing on the .mist row
    expect(row.textContent).toContain('is a mistake');
    expect(row.querySelector('.mname.mist')).not.toBeNull();
    // Result pill: 0-1 → badv
    const badge = row.querySelector('.badge');
    expect(badge?.textContent).toBe('0-1');
    expect(badge?.classList.contains('badv')).toBe(true);
  });
});
