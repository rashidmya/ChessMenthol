import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Lines from '../components/Lines.svelte';

describe('Lines', () => {
  it('renders one row per line with score and san', () => {
    render(Lines, { lines: [
      { multipv: 1, scoreText: '+0.30', cp: 30, mate: null, pv: ['e2e4'], san: '1. e4' },
      { multipv: 2, scoreText: '+0.10', cp: 10, mate: null, pv: ['d2d4'], san: '1. d4' },
    ] });
    const rows = screen.getAllByTestId('line-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('+0.30');
    expect(rows[0].textContent).toContain('1. e4');
  });

  it('renders nothing when there are no lines', () => {
    render(Lines, { lines: [] });
    expect(screen.queryAllByTestId('line-row')).toHaveLength(0);
  });
});
