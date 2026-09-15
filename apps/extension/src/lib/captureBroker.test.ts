import { describe, it, expect, vi } from 'vitest';
import { brokerCapture } from './captureBroker';

describe('brokerCapture', () => {
  it('captures the requested window as PNG and returns the data URL', async () => {
    const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,AAAA');
    const res = await brokerCapture({ captureVisibleTab }, { kind: 'capture-request', windowId: 7 });
    expect(captureVisibleTab).toHaveBeenCalledWith(7, { format: 'png' });
    expect(res).toEqual({ kind: 'capture-result', dataUrl: 'data:image/png;base64,AAAA' });
  });
  it('passes undefined (current window) when no window id was sent', async () => {
    const captureVisibleTab = vi.fn(async () => 'x');
    await brokerCapture({ captureVisibleTab }, { kind: 'capture-request' });
    expect(captureVisibleTab).toHaveBeenCalledWith(undefined, { format: 'png' });
  });
  it('turns a thrown error into a null result carrying the message', async () => {
    const res = await brokerCapture({ captureVisibleTab: async () => { throw new Error('quota'); } }, { kind: 'capture-request' });
    expect(res).toEqual({ kind: 'capture-result', dataUrl: null, error: 'quota' });
  });
});
