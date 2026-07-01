import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import EvalGraph from '../components/EvalGraph.svelte';

const wins = [51, 60, 48, 62, 20, 97];

describe('EvalGraph', () => {
  it('renders an SVG path and a marker', () => {
    const { container } = render(EvalGraph, { props: { wins, currentPly: 2 } });
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('[data-testid="eval-curve"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="eval-marker"]')).toBeTruthy();
  });

  it('calls onNavigate with the nearest ply on click', async () => {
    const onNavigate = vi.fn();
    const { container } = render(EvalGraph, { props: { wins, currentPly: 0, onNavigate } });
    const svg = container.querySelector('svg')!;
    // jsdom returns 0-size rects; provide a stub so the fraction math is deterministic.
    svg.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 96, right: 100, bottom: 96, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await fireEvent.click(svg, { clientX: 100 });
    expect(onNavigate).toHaveBeenCalledWith(wins.length - 1);
  });
});
