import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RegionOverlay from '../components/RegionOverlay.svelte';

const shot = { type: 'region_shot' as const, jpegBase64: 'AAAA', width: 1000, height: 500 };

describe('RegionOverlay', () => {
  it('shows a capturing state until a shot arrives', () => {
    render(RegionOverlay, { props: { shot: null, onConfirm: vi.fn(), onCancel: vi.fn() } as any });
    expect(screen.getByTestId('overlay-capturing')).toBeTruthy();
  });

  it('renders the screenshot when a shot is present', () => {
    render(RegionOverlay, { props: { shot, onConfirm: vi.fn(), onCancel: vi.fn() } as any });
    const img = screen.getByTestId('overlay-img') as HTMLImageElement;
    expect(img.src).toContain('data:image/jpeg;base64,AAAA');
  });

  it('Cancel calls onCancel', async () => {
    const onCancel = vi.fn();
    render(RegionOverlay, { props: { shot, onConfirm: vi.fn(), onCancel } as any });
    await fireEvent.click(screen.getByTestId('overlay-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('a drag + Use emits a true-pixel region via onConfirm', async () => {
    const onConfirm = vi.fn();
    render(RegionOverlay, { props: { shot, onConfirm, onCancel: vi.fn() } as any });
    const img = screen.getByTestId('overlay-img') as HTMLImageElement;
    // Make the image report a 500x250 display rect (half the 1000x500 true size).
    img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 250,
      right: 500, bottom: 250, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    Object.defineProperty(img, 'clientWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'clientHeight', { value: 250, configurable: true });
    await fireEvent.mouseDown(img, { clientX: 50, clientY: 25 });
    await fireEvent.mouseMove(window, { clientX: 150, clientY: 75 });
    await fireEvent.mouseUp(window, { clientX: 150, clientY: 75 });
    await fireEvent.click(screen.getByTestId('overlay-use'));
    // 50..150 displayed *2 -> 100..300 true; 25..75 *2 -> 50..150 true.
    expect(onConfirm).toHaveBeenCalledWith({ left: 100, top: 50, width: 200, height: 100 });
  });
});
