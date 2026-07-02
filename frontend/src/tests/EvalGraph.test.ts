import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import EvalGraph from '../components/EvalGraph.svelte';

const wins = [51, 60, 48, 62, 20, 97];
const evals = ['+0.10', '+0.30', '-0.20', '+0.60', '-2.10', '+M3'];
const labels = ['Start', '1. e4', '1… e5', '2. Nf3', '2… Nf6', '3. Bb5'];
// idx 2 = a "best" move (ordinary, not highlighted); idx 5 = an inaccuracy (notable).
const classes = [null, null, { label: 'best', cpl: 0, isBest: true }, null, null,
  { label: 'inaccuracy', cpl: 60, isBest: false }];

// jsdom returns 0-size rects; stub so the fraction math is deterministic (width 100).
function stubRect(svg: SVGSVGElement): void {
  svg.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 96, right: 100, bottom: 96, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

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
    const svg = container.querySelector('svg')! as SVGSVGElement;
    stubRect(svg);
    await fireEvent.click(svg, { clientX: 100 });
    expect(onNavigate).toHaveBeenCalledWith(wins.length - 1);
  });

  it('shows a tooltip with the eval and move label at the hovered point', async () => {
    const { container } = render(EvalGraph, { props: { wins, currentPly: 0, evals, labels } });
    const svg = container.querySelector('svg')! as SVGSVGElement;
    stubRect(svg);
    await fireEvent.mouseMove(svg, { clientX: 100 }); // frac 1.0 -> nearest index 5
    const tip = container.querySelector('[data-testid="eval-tip"]');
    expect(tip).toBeTruthy();
    expect(tip!.textContent).toContain('+M3');    // evals[5]
    expect(tip!.textContent).toContain('3. Bb5'); // labels[5]
  });

  it('annotates the tooltip with the move class for a notable move', async () => {
    const { container } = render(EvalGraph, { props: { wins, currentPly: 0, evals, labels, classes } });
    const svg = container.querySelector('svg')! as SVGSVGElement;
    stubRect(svg);
    await fireEvent.mouseMove(svg, { clientX: 100 }); // index 5 -> inaccuracy
    const cls = container.querySelector('[data-testid="eval-tip-cls"]');
    expect(cls).toBeTruthy();
    expect(cls!.textContent).toContain('Inaccuracy');
  });

  it('omits the class annotation for an ordinary (non-notable) move', async () => {
    const { container } = render(EvalGraph, { props: { wins, currentPly: 0, evals, labels, classes } });
    const svg = container.querySelector('svg')! as SVGSVGElement;
    stubRect(svg);
    await fireEvent.mouseMove(svg, { clientX: 40 }); // index 2 -> "best", not highlighted
    expect(container.querySelector('[data-testid="eval-tip"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="eval-tip-cls"]')).toBeNull();
  });

  it('hides the tooltip on mouse leave', async () => {
    const { container } = render(EvalGraph, { props: { wins, currentPly: 0, evals, labels } });
    const svg = container.querySelector('svg')! as SVGSVGElement;
    stubRect(svg);
    await fireEvent.mouseMove(svg, { clientX: 50 });
    expect(container.querySelector('[data-testid="eval-tip"]')).toBeTruthy();
    await fireEvent.mouseLeave(svg);
    expect(container.querySelector('[data-testid="eval-tip"]')).toBeNull();
  });
});
