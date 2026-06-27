import { it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { vi } from 'vitest';
import MoveFeedback from '../components/MoveFeedback.svelte';

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

it('shows continuation PV via figurine conversion', () => {
  const { getByTestId } = render(MoveFeedback, { lastMove: dto, onPlayBest: () => {} });
  // '16. Nxc3' → '16. ♞xc3'
  expect(getByTestId('row-played').textContent).toContain('♞xc3');
});
