import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EvalBar from '../components/EvalBar.svelte';

describe('EvalBar', () => {
  it('shows 1-decimal score for positive cp and fill > 50%', () => {
    render(EvalBar, { evalDto: { cp: 34, mate: null, text: '+0.34' } });
    expect(screen.getByTestId('eval-score').textContent).toBe('0.3');
    const fill = screen.getByTestId('eval-fill') as HTMLElement;
    const height = parseFloat(fill.style.height);
    expect(height).toBeGreaterThan(50);
  });

  it('shows M<n> for negative mate (no sign)', () => {
    render(EvalBar, { evalDto: { cp: null, mate: -3, text: '#-3' } });
    expect(screen.getByTestId('eval-score').textContent).toBe('M3');
  });

  it('shows 0.0 and ~50% fill height for null eval', () => {
    render(EvalBar, { evalDto: null });
    expect(screen.getByTestId('eval-score').textContent).toBe('0.0');
    const fill = screen.getByTestId('eval-fill') as HTMLElement;
    const height = parseFloat(fill.style.height);
    expect(height).toBeCloseTo(50, 0);
  });

  it('flip: orientation black → fill anchors at top (not bottom)', () => {
    render(EvalBar, { evalDto: { cp: 300, mate: null, text: '+3.00' }, orientation: 'black' });
    const fill = screen.getByTestId('eval-fill') as HTMLElement;
    expect(fill.style.top).not.toBe('');
    expect(fill.style.bottom).toBe('');
  });

  it('flip: orientation white → fill anchors at bottom (not top)', () => {
    render(EvalBar, { evalDto: { cp: 300, mate: null, text: '+3.00' }, orientation: 'white' });
    const fill = screen.getByTestId('eval-fill') as HTMLElement;
    expect(fill.style.bottom).not.toBe('');
    expect(fill.style.top).toBe('');
  });

  it('white ahead: score does NOT have light class', () => {
    render(EvalBar, { evalDto: { cp: 300, mate: null, text: '+3.00' } });
    const score = screen.getByTestId('eval-score');
    expect(score.classList.contains('light')).toBe(false);
  });

  it('black ahead: score HAS light class', () => {
    render(EvalBar, { evalDto: { cp: -300, mate: null, text: '-3.00' } });
    const score = screen.getByTestId('eval-score');
    expect(score.classList.contains('light')).toBe(true);
  });

  it('white ahead, not flipped: score sits at the bottom (white end)', () => {
    render(EvalBar, { evalDto: { cp: 300, mate: null, text: '+3.00' }, orientation: 'white' });
    const score = screen.getByTestId('eval-score') as HTMLElement;
    expect(score.style.bottom).not.toBe('');
    expect(score.style.top).toBe('');
  });

  it('black ahead, not flipped: score sits at the top (black end)', () => {
    render(EvalBar, { evalDto: { cp: -300, mate: null, text: '-3.00' }, orientation: 'white' });
    const score = screen.getByTestId('eval-score') as HTMLElement;
    expect(score.style.top).not.toBe('');
    expect(score.style.bottom).toBe('');
  });

  it('white ahead, flipped: score sits at the top (white end is now top)', () => {
    render(EvalBar, { evalDto: { cp: 300, mate: null, text: '+3.00' }, orientation: 'black' });
    const score = screen.getByTestId('eval-score') as HTMLElement;
    expect(score.style.top).not.toBe('');
    expect(score.style.bottom).toBe('');
  });

  it('game over 1-0: score text is "1-0" and fill height is 100%', () => {
    render(EvalBar, { gameOver: { result: '1-0', reason: 'checkmate' } });
    expect(screen.getByTestId('eval-score').textContent).toBe('1-0');
    const fill = screen.getByTestId('eval-fill') as HTMLElement;
    expect(parseFloat(fill.style.height)).toBe(100);
  });

  it('game over 0-1: score text is "0-1" and fill height is 0%', () => {
    render(EvalBar, { gameOver: { result: '0-1', reason: 'checkmate' } });
    expect(screen.getByTestId('eval-score').textContent).toBe('0-1');
    const fill = screen.getByTestId('eval-fill') as HTMLElement;
    expect(parseFloat(fill.style.height)).toBe(0);
  });

  it('game over 1/2-1/2: score text is "½" and fill height is 50%', () => {
    render(EvalBar, { gameOver: { result: '1/2-1/2', reason: 'stalemate' } });
    expect(screen.getByTestId('eval-score').textContent).toBe('½');
    const fill = screen.getByTestId('eval-fill') as HTMLElement;
    expect(parseFloat(fill.style.height)).toBe(50);
  });

  it('horizontal: fill uses width (not height) and the bar carries the horizontal class', () => {
    const { getByTestId } = render(EvalBar, { props: { evalDto: { cp: 300, mate: null, text: '+3.00' }, horizontal: true } });
    const fill = getByTestId('eval-fill') as HTMLElement;
    expect(fill.style.width).not.toBe('');
    expect(fill.style.height).toBe('');
    expect(getByTestId('evalbar').classList.contains('horizontal')).toBe(true);
  });
});
