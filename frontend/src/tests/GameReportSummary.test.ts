import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import GameReportSummary from '../components/GameReportSummary.svelte';
import type { GameReportDto } from '../lib/types';

function pr(over: Partial<import('../lib/types').PlayerReportDto> = {}) {
  return { accuracy: 88, acpl: 20, brilliant: 0, great: 1, best: 18, excellent: 14, good: 2,
    book: 1, inaccuracy: 2, mistake: 1, blunder: 0, miss: 0, ...over };
}
const report: GameReportDto = {
  white: pr({ accuracy: 88, acpl: 17 }), black: pr({ accuracy: 82, acpl: 29, blunder: 3 }),
  whiteName: 'Ada', blackName: 'Bo', startWin: 50, plies: [],
};

describe('GameReportSummary', () => {
  it('shows both accuracy dials, player names, and the per-side ACPL/counts table', () => {
    const { getByTestId, getAllByText, container } = render(GameReportSummary, { props: { report } });
    expect(getByTestId('report-panel')).toBeTruthy();
    // two accuracy dials, each showing its rounded percent
    expect(container.querySelectorAll('.dial').length).toBe(2);
    expect(getByTestId('acc-white').textContent).toContain('88');
    expect(getByTestId('acc-black').textContent).toContain('82');
    // player names appear (on the dial + in the counts table)
    expect(getAllByText('Ada').length).toBeGreaterThan(0);
    expect(getAllByText('Bo').length).toBeGreaterThan(0);
    // ACPL per side lands in the right row
    expect(getByTestId('acpl-white').textContent).toContain('17');
    expect(getByTestId('acpl-black').textContent).toContain('29');
  });

  it('falls back to White/Black when names are absent', () => {
    const { getAllByText } = render(GameReportSummary, { props: { report: { ...report, whiteName: undefined, blackName: undefined } } });
    expect(getAllByText('White').length).toBeGreaterThan(0);
    expect(getAllByText('Black').length).toBeGreaterThan(0);
  });

  it('fires Start Review, Back-to-analysis, and New handlers', async () => {
    const onStartReview = vi.fn(), onBackToAnalysis = vi.fn(), onNew = vi.fn();
    const { getByTestId, getByText } = render(GameReportSummary, { props: { report, onStartReview, onBackToAnalysis, onNew } });
    await fireEvent.click(getByTestId('start-review')); expect(onStartReview).toHaveBeenCalled();
    await fireEvent.click(getByTestId('report-to-analysis')); expect(onBackToAnalysis).toHaveBeenCalled();
    await fireEvent.click(getByText('New')); expect(onNew).toHaveBeenCalled();
  });
});
