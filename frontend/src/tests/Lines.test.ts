import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Lines from '../components/Lines.svelte';

const mk = (mpv: number, cp: number, san: string) => ({
  multipv: mpv,
  scoreText: cp >= 0 ? `+${(cp / 100).toFixed(2)}` : (cp / 100).toFixed(2),
  cp,
  mate: null,
  pv: [],
  san,
});

describe('Lines', () => {
  it('keeps the +/- sign, marks neg lines, and expands on click', async () => {
    const { getAllByTestId, getAllByTitle } = render(Lines, {
      lines: [mk(1, 34, '1.e4 e5'), mk(2, -7, '1.c4 e5')],
    });
    const rows = getAllByTestId('line-row');
    expect(rows[0].textContent).toContain('+0.34');
    expect(rows[0].className).toContain('pos');
    expect(rows[1].className).toContain('neg');
    await fireEvent.click(getAllByTitle('Show full line')[0]);
    expect(rows[0].className).toContain('open');
  });

  it('renders nothing when there are no lines', () => {
    const { queryAllByTestId } = render(Lines, { lines: [] });
    expect(queryAllByTestId('line-row')).toHaveLength(0);
  });

  it('applies figurine conversion to PV text', () => {
    const { getByTestId } = render(Lines, { lines: [mk(1, 50, '1.Nf3 Nc6')] });
    expect(getByTestId('line-row').textContent).toContain('♞f3');
  });
});
