import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import HomePanel from '../components/HomePanel.svelte';

describe('HomePanel', () => {
  it('renders the start controls and hides Capture without native capture', () => {
    const { getByText, queryByText } = render(HomePanel, { props: { hasCapture: false } });
    expect(getByText('Set Up Position')).toBeTruthy();
    expect(getByText('Explore')).toBeTruthy();
    expect(getByText('Start Analysis')).toBeTruthy();
    expect(queryByText('Capture Board')).toBeNull();
  });

  it('shows Capture Board when hasCapture is true', () => {
    const { getByText } = render(HomePanel, { props: { hasCapture: true } });
    expect(getByText('Capture Board')).toBeTruthy();
  });

  it('fires navigation callbacks', async () => {
    const onSetUp = vi.fn(), onExplore = vi.fn(), onCapture = vi.fn();
    const { getByText } = render(HomePanel, {
      props: { hasCapture: true, onSetUp, onExplore, onCapture },
    });
    await fireEvent.click(getByText('Set Up Position')); expect(onSetUp).toHaveBeenCalled();
    await fireEvent.click(getByText('Explore')); expect(onExplore).toHaveBeenCalled();
    await fireEvent.click(getByText('Capture Board')); expect(onCapture).toHaveBeenCalled();
  });

  it('passes the textarea text to onStart', async () => {
    const onStart = vi.fn();
    const { getByText, getByPlaceholderText } = render(HomePanel, { props: { onStart } });
    await fireEvent.input(getByPlaceholderText(/Paste your FEN/), {
      target: { value: '8/8/8/8/8/8/8/8 w - - 0 1' },
    });
    await fireEvent.click(getByText('Start Analysis'));
    expect(onStart).toHaveBeenCalledWith('8/8/8/8/8/8/8/8 w - - 0 1');
  });
});
