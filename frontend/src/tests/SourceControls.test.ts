import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SourceControls from '../components/SourceControls.svelte';
describe('SourceControls', () => {
  it('disables Capture until a region is set and shows Board Undetected', () => {
    const { getByText } = render(SourceControls, { props: { region: null, visionStatus: 'no_board', onCommand: vi.fn(), onPickRegion: vi.fn() } });
    expect((getByText('Capture Board') as HTMLButtonElement).disabled).toBe(true);
    expect(getByText('Board Undetected')).toBeTruthy();
  });
  it('enables Capture and emits capture_now when a region exists', async () => {
    const onCommand = vi.fn();
    const { getByText } = render(SourceControls, { props: { region: { left:0, top:0, width:10, height:10 }, visionStatus: 'found', onCommand, onPickRegion: vi.fn() } });
    const btn = getByText('Capture Board') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await fireEvent.click(btn);
    expect(onCommand).toHaveBeenCalledWith({ type: 'capture_now' });
  });
  it('emits clear_region and calls onPickRegion', async () => {
    const onCommand = vi.fn(); const onPickRegion = vi.fn();
    const { getByText } = render(SourceControls, { props: { region: null, visionStatus: 'idle', onCommand, onPickRegion } });
    await fireEvent.click(getByText('Select Region')); expect(onPickRegion).toHaveBeenCalled();
    await fireEvent.click(getByText('Clear Selection')); expect(onCommand).toHaveBeenCalledWith({ type: 'clear_region' });
  });
  it('shows N uncertain on low confidence', () => {
    const { getByText } = render(SourceControls, { props: { region: null, visionStatus: 'low_confidence', lowConfidence: ['a1','b2'], onCommand: vi.fn(), onPickRegion: vi.fn() } });
    expect(getByText('2 uncertain')).toBeTruthy();
  });
});
