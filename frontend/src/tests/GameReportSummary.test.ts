import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import GameReportSummary from '../components/GameReportSummary.svelte';
import type { GameReportDto } from '../lib/types';

function pr(over: Partial<import('../lib/types').PlayerReportDto> = {}) {
  return { accuracy: 88, acpl: 20, brilliant: 0, great: 1, best: 18, excellent: 14, good: 2,
    book: 1, inaccuracy: 2, mistake: 1, blunder: 0, miss: 0, ...over };
}
const report: GameReportDto = {
  white: pr({ accuracy: 88 }), black: pr({ accuracy: 82, blunder: 1 }),
  whiteName: 'Ada', blackName: 'Bo', startWin: 50, plies: [],
};

describe('GameReportSummary', () => {
  it('shows both accuracies, player names, and per-side class counts', () => {
    const { getByTestId, getByText } = render(GameReportSummary, { props: { report } });
    expect(getByTestId('acc-white').textContent).toContain('88');
    expect(getByTestId('acc-black').textContent).toContain('82');
    expect(getByText('Ada')).toBeTruthy();
    expect(getByText('Bo')).toBeTruthy();
    // blunder row: the count lands in the correct column — white (first .cnt) 0, black (last .cnt) 1.
    const cnts = getByTestId('cat-blunder').querySelectorAll('.cnt');
    expect(cnts[0].textContent).toBe('0');                 // white column
    expect(cnts[cnts.length - 1].textContent).toBe('1');   // black column (blunder = 1)
  });

  it('falls back to White/Black when names are absent', () => {
    const { getByText } = render(GameReportSummary, { props: { report: { ...report, whiteName: undefined, blackName: undefined } } });
    expect(getByText('White')).toBeTruthy();
    expect(getByText('Black')).toBeTruthy();
  });

  it('fires Start Review, Back-to-analysis, and New handlers', async () => {
    const onStartReview = vi.fn(), onBackToAnalysis = vi.fn(), onNew = vi.fn();
    const { getByTestId, getByText } = render(GameReportSummary, { props: { report, onStartReview, onBackToAnalysis, onNew } });
    await fireEvent.click(getByTestId('start-review')); expect(onStartReview).toHaveBeenCalled();
    await fireEvent.click(getByTestId('report-to-analysis')); expect(onBackToAnalysis).toHaveBeenCalled();
    await fireEvent.click(getByText('New')); expect(onNew).toHaveBeenCalled();
  });
});
