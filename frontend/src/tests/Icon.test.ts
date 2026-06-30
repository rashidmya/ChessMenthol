import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Icon from '../components/Icon.svelte';
import { licon } from '../lib/licon';

describe('Icon', () => {
  it('renders the licon codepoint via data-icon and is decorative by default', () => {
    const { container } = render(Icon, { props: { name: 'Gear' } });
    const span = container.querySelector('span.icon');
    expect(span).toBeTruthy();
    expect(span?.getAttribute('data-icon')).toBe(licon.Gear);
    expect(span?.getAttribute('aria-hidden')).toBe('true');
    expect(span?.getAttribute('role')).toBeNull();
  });

  it('becomes a labelled img when a label is provided', () => {
    const { container } = render(Icon, { props: { name: 'Gear', label: 'Engine settings' } });
    const span = container.querySelector('span.icon');
    expect(span?.getAttribute('role')).toBe('img');
    expect(span?.getAttribute('aria-label')).toBe('Engine settings');
    expect(span?.getAttribute('aria-hidden')).toBeNull();
  });
});
