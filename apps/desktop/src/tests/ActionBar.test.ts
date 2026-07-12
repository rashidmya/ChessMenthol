import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ActionBar from '../components/ActionBar.svelte';

describe('ActionBar trigger', () => {
  it('shows "Request computer analysis" by default and calls onRequestAnalysis', async () => {
    const onRequestAnalysis = vi.fn();
    const { getByTestId, getByText } = render(ActionBar, {
      props: { currentPly: 0, total: 4, onRequestAnalysis, reportProgress: null, hasReportForGame: false },
    });
    expect(getByText('Request computer analysis')).toBeTruthy();
    await fireEvent.click(getByTestId('request-analysis'));
    expect(onRequestAnalysis).toHaveBeenCalled();
  });

  it('shows "View game report" when a matching report exists', async () => {
    const onRequestAnalysis = vi.fn();
    const { getByText, getByTestId } = render(ActionBar, {
      props: { currentPly: 0, total: 4, hasReportForGame: true, reportProgress: null, onRequestAnalysis },
    });
    expect(getByText('View game report')).toBeTruthy();
    await fireEvent.click(getByTestId('request-analysis'));
    expect(onRequestAnalysis).toHaveBeenCalled();
  });

  it('shows Cancel + progress while a batch runs', async () => {
    const onCancelAnalysis = vi.fn();
    const { getByTestId, queryByTestId } = render(ActionBar, {
      props: { currentPly: 0, total: 4, reportProgress: { done: 2, total: 5 }, onCancelAnalysis },
    });
    const cancel = getByTestId('analysis-progress');
    await fireEvent.click(cancel.querySelector('button')!);
    expect(onCancelAnalysis).toHaveBeenCalled();
    expect(queryByTestId('request-analysis')).toBeNull();
  });

  it('disables the trigger when there is no game (total 0)', () => {
    const { getByTestId } = render(ActionBar, {
      props: { currentPly: 0, total: 0, hasReportForGame: false, reportProgress: null },
    });
    expect((getByTestId('request-analysis') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ActionBar', () => {
  it('navigates first/prev/next/last relative to currentPly/total', async () => {
    const onNavigate = vi.fn();
    const { getByTitle } = render(ActionBar, { props: { currentPly: 3, total: 5, onNavigate } });
    await fireEvent.click(getByTitle('First move')); expect(onNavigate).toHaveBeenCalledWith(0);
    await fireEvent.click(getByTitle('Previous move')); expect(onNavigate).toHaveBeenCalledWith(2);
    await fireEvent.click(getByTitle('Next move')); expect(onNavigate).toHaveBeenCalledWith(4);
    await fireEvent.click(getByTitle('Last move')); expect(onNavigate).toHaveBeenCalledWith(5);
  });

  it('emits onNew when the New action is clicked', async () => {
    const onNew = vi.fn();
    const { getByText } = render(ActionBar, { props: { currentPly: 0, total: 0, onNavigate: vi.fn(), onNew } });
    await fireEvent.click(getByText('New'));
    expect(onNew).toHaveBeenCalled();
  });
});

describe('ActionBar narrow', () => {
  const base = {
    currentPly: 1, total: 5, onNavigate: () => {}, onNew: () => {},
    onRequestAnalysis: () => {}, onCancelAnalysis: () => {},
    reportProgress: null, hasReportForGame: false,
  };
  it('wide: renders 4 nav buttons + Request + New (6 buttons)', () => {
    const { getAllByRole } = render(ActionBar, { props: { ...base, narrow: false } });
    expect(getAllByRole('button').length).toBe(6);
  });
  it('narrow: omits the stepper, leaving Request + New (2 buttons)', () => {
    const { getAllByRole, queryByTitle } = render(ActionBar, { props: { ...base, narrow: true } });
    expect(getAllByRole('button').length).toBe(2);
    expect(queryByTitle('First move')).toBeNull();
  });
});
