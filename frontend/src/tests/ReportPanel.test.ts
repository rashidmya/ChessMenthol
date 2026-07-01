import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ReportPanel from '../components/ReportPanel.svelte';
import type { GameReportDto, MoveEntryDto } from '../lib/types';

const report: GameReportDto = {
  white: { accuracy: 92, acpl: 19, inaccuracy: 1, mistake: 0, blunder: 0 },
  black: { accuracy: 45, acpl: 288, inaccuracy: 0, mistake: 0, blunder: 1 },
  startWin: 51,
  plies: [
    { ply: 1, san: 'e4', uci: 'e2e4', winWhite: 53, cpl: 0, classification: null },
    { ply: 2, san: 'e5', uci: 'e7e5', winWhite: 50, cpl: 0, classification: null },
  ],
};
const moveList: MoveEntryDto[] = [
  { ply: 1, san: 'e4', uci: 'e2e4', classification: null },
  { ply: 2, san: 'e5', uci: 'e7e5', classification: null },
];

describe('ReportPanel', () => {
  it('shows both accuracy numbers and counts', () => {
    const { getByText } = render(ReportPanel, { props: { report, moveList, currentPly: 0 } });
    expect(getByText('92')).toBeTruthy();
    expect(getByText('45')).toBeTruthy();
  });

  it('calls onBack from the back button', async () => {
    const onBack = vi.fn();
    const { getByTestId } = render(ReportPanel, { props: { report, moveList, currentPly: 0, onBack } });
    await fireEvent.click(getByTestId('report-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
