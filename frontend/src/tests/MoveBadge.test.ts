import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MoveBadge from '../components/MoveBadge.svelte';

describe('MoveBadge', () => {
  it('renders an accessible svg with a capitalized default title', () => {
    const { getByRole } = render(MoveBadge, { label: 'blunder' });
    const svg = getByRole('img', { name: 'Blunder' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('fills the disc with the label color from glyphs', () => {
    const { container } = render(MoveBadge, { label: 'brilliant' });
    const disc = container.querySelector('circle');
    expect(disc?.getAttribute('fill')).toBe('#1aa99c');
  });

  it('honors a custom size and title', () => {
    const { getByRole } = render(MoveBadge, { label: 'best', size: 40, title: 'Best move' });
    const svg = getByRole('img', { name: 'Best move' });
    expect(svg.getAttribute('width')).toBe('40');
  });

  it('draws the text symbol for a text-kind label', () => {
    const { container } = render(MoveBadge, { label: 'blunder' });
    expect(container.textContent).toContain('??');
  });
});
