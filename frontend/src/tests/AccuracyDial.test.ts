import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AccuracyDial from '../components/AccuracyDial.svelte';

describe('AccuracyDial', () => {
  it('renders the rounded percent and the label', () => {
    const { getByTestId, getByText } = render(AccuracyDial, {
      props: { percent: 87.6, label: 'Ada', side: 'white', testid: 'd' },
    });
    expect(getByTestId('d').textContent).toContain('88'); // rounded
    expect(getByText('Ada')).toBeTruthy();
  });

  it('renders without a testid or side', () => {
    const { container, getByText } = render(AccuracyDial, { props: { percent: 50, label: 'Black' } });
    expect(container.querySelector('.dial')).toBeTruthy();
    expect(getByText('Black')).toBeTruthy();
  });
});
