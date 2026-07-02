import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Panel from '../components/Panel.svelte';
import PanelHarness from './PanelHarness.svelte';

describe('Panel', () => {
  it('renders the title text', () => {
    const { getByText } = render(Panel, { props: { title: 'Game Review' } });
    expect(getByText('Game Review')).toBeTruthy();
  });

  it('applies the testid prop to the root card', () => {
    const { getByTestId } = render(Panel, { props: { title: 'X', testid: 'my-panel' } });
    expect(getByTestId('my-panel')).toBeTruthy();
  });

  it('renders left, right, and default (body) slot content', () => {
    const { getByTestId } = render(PanelHarness);
    expect(getByTestId('hl').textContent).toContain('L');
    expect(getByTestId('hr').textContent).toContain('R');
    expect(getByTestId('body').textContent).toContain('body content');
  });

  it('renders a footer region when the footer slot is provided', () => {
    const { getByTestId } = render(PanelHarness);
    const footer = getByTestId('panel-footer');
    expect(footer).toBeTruthy();
    expect(footer.textContent).toContain('controls here');
  });

  it('omits the footer region when no footer slot is provided', () => {
    const { queryByTestId } = render(Panel, { props: { title: 'X' } });
    expect(queryByTestId('panel-footer')).toBeNull();
  });
});
