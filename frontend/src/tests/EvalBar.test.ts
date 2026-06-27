import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EvalBar from '../components/EvalBar.svelte';

describe('EvalBar', () => {
  it('shows unsigned score (no + sign) for positive cp and fill > 50%', () => {
    render(EvalBar, { evalDto: { cp: 34, mate: null, text: '+0.34' } });
    expect(screen.getByTestId('eval-score').textContent).toBe('0.34');
    const fill = screen.getByTestId('eval-fill') as HTMLElement;
    const height = parseFloat(fill.style.height);
    expect(height).toBeGreaterThan(50);
  });

  it('shows M<n> for negative mate (no sign)', () => {
    render(EvalBar, { evalDto: { cp: null, mate: -3, text: '#-3' } });
    expect(screen.getByTestId('eval-score').textContent).toBe('M3');
  });

  it('shows 0.0 and ~50% fill height for null eval', () => {
    render(EvalBar, { evalDto: null });
    expect(screen.getByTestId('eval-score').textContent).toBe('0.0');
    const fill = screen.getByTestId('eval-fill') as HTMLElement;
    const height = parseFloat(fill.style.height);
    expect(height).toBeCloseTo(50, 0);
  });
});
