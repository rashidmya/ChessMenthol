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
    // brilliant row: white 0 / black 0
    expect(getByTestId('cat-blunder').textContent).toContain('1'); // black blunder = 1
  });

  it('falls back to White/Black when names are absent', () => {
    const { getByText } = render(GameReportSummary, { props: { report: { ...report, whiteName: undefined, blackName: undefined } } });
    expect(getByText('White')).toBeTruthy();
    expect(getByText('Black')).toBeTruthy();
  });

  it('fires Start Review and Back-to-analysis handlers', async () => {
    const onStartReview = vi.fn(), onBackToAnalysis = vi.fn();
    const { getByTestId } = render(GameReportSummary, { props: { report, onStartReview, onBackToAnalysis } });
    await fireEvent.click(getByTestId('start-review')); expect(onStartReview).toHaveBeenCalled();
    await fireEvent.click(getByTestId('report-to-analysis')); expect(onBackToAnalysis).toHaveBeenCalled();
  });
});
