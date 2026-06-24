import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Badge from '../components/Badge.svelte';

describe('Badge', () => {
  it('shows the classification label for the last move', () => {
    render(Badge, { lastMove: { uci: 'g5h7', classification: { label: 'brilliant', cpl: 0, isBest: true } } });
    const badge = screen.getByTestId('badge');
    expect(badge.textContent?.toLowerCase()).toContain('brilliant');
  });

  it('renders nothing without a last move', () => {
    render(Badge, { lastMove: null });
    expect(screen.queryByTestId('badge')).toBeNull();
  });
});
