import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EvalBar from '../components/EvalBar.svelte';

describe('EvalBar', () => {
  it('shows the score text', () => {
    render(EvalBar, { evalDto: { cp: 140, mate: null, text: '+1.40' } });
    expect(screen.getByTestId('eval-score').textContent).toContain('+1.40');
  });

  it('renders empty score for a null eval', () => {
    render(EvalBar, { evalDto: null });
    expect(screen.getByTestId('eval-score').textContent?.trim()).toBe('');
  });
});
