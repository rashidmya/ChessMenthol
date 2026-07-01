import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AccuracyDial from '../components/AccuracyDial.svelte';

describe('AccuracyDial', () => {
  it('renders the percentage and a progress ring', () => {
    const { container, getByText } = render(AccuracyDial, { props: { percent: 86, label: 'White' } });
    expect(getByText('86')).toBeTruthy();
    const rings = container.querySelectorAll('circle');
    expect(rings.length).toBeGreaterThanOrEqual(2); // track + progress
  });
});
