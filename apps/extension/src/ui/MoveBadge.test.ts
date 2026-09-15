import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MoveBadge from '../../entrypoints/sidepanel/components/MoveBadge.svelte';

describe('MoveBadge (extension copy)', () => {
  it('renders an accessible svg with a capitalized default title', () => {
    const { getByRole } = render(MoveBadge, { label: 'blunder' });
    expect(getByRole('img', { name: 'Blunder' }).tagName.toLowerCase()).toBe('svg');
  });
  it('fills the disc with the label color from the shared glyphs', () => {
    const { container } = render(MoveBadge, { label: 'brilliant' });
    expect(container.querySelector('circle')?.getAttribute('fill')).toBe('#1aa99c');
  });
  it('draws a path (not text) for a drawn-kind label', () => {
    const { container } = render(MoveBadge, { label: 'best' });
    expect(container.querySelector('path')).not.toBeNull();
    expect(container.querySelector('text')).toBeNull();
  });
});
