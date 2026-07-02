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
    // Element box == painted image (no letterbox): 500x250 display rect, half the
    // 1000x500 true size; natural matches the element aspect (2:1).
    img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 250,
      right: 500, bottom: 250, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 500, configurable: true });
    await fireEvent.mouseDown(img, { clientX: 50, clientY: 25 });
    await fireEvent.mouseMove(window, { clientX: 150, clientY: 75 });
    await fireEvent.mouseUp(window, { clientX: 150, clientY: 75 });
    await fireEvent.click(screen.getByTestId('overlay-use'));
    // 50..150 displayed *2 -> 100..300 true; 25..75 *2 -> 50..150 true.
    expect(onConfirm).toHaveBeenCalledWith({ left: 100, top: 50, width: 200, height: 100 });
  });

  it('maps relative to the painted image rect when the element is letterboxed', async () => {
    const onConfirm = vi.fn();
    render(RegionOverlay, { props: { shot, onConfirm, onCancel: vi.fn() } as any });
    const img = screen.getByTestId('overlay-img') as HTMLImageElement;
    // Element box is 500x500 (square), but the image is 2:1 (natural 1000x500),
    // so object-fit:contain paints it 500x250 centered → 125px letterbox top &
    // bottom. A box drawn on the painted area must subtract that 125px offset.
    img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500,
      right: 500, bottom: 500, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 500, configurable: true });
    // Drag inside the painted strip (y 125..375): (50,150) -> (150,250).
    await fireEvent.mouseDown(img, { clientX: 50, clientY: 150 });
    await fireEvent.mouseMove(window, { clientX: 150, clientY: 250 });
    await fireEvent.mouseUp(window, { clientX: 150, clientY: 250 });
    await fireEvent.click(screen.getByTestId('overlay-use'));
    // painted=500x250, offY=125. box {x:50,y:150,w:100,h:100} -> painted {50,25,100,100}
    // -> *2 (1000/500, 500/250) -> { left:100, top:50, width:200, height:200 }.
    expect(onConfirm).toHaveBeenCalledWith({ left: 100, top: 50, width: 200, height: 200 });
  });

  it('Esc key calls onCancel', async () => {
    const onCancel = vi.fn();
    render(RegionOverlay, { props: { shot, onConfirm: vi.fn(), onCancel } as any });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('a click without dragging cancels instead of emitting a zero region', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(RegionOverlay, { props: { shot, onConfirm, onCancel } as any });
    const img = screen.getByTestId('overlay-img') as HTMLImageElement;
    img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 250,
      right: 500, bottom: 250, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    await fireEvent.mouseDown(img, { clientX: 50, clientY: 25 });
    await fireEvent.mouseUp(window, { clientX: 50, clientY: 25 });
    await fireEvent.click(screen.getByTestId('overlay-use'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
