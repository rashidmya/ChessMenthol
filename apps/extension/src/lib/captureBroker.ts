import type { CaptureRequest, CaptureResult } from './messages';

/** The one tabs API call the background makes; injected so it is unit-testable. */
export interface CaptureApi {
  captureVisibleTab(windowId: number | undefined, opts: { format: 'png' }): Promise<string>;
}

/** Capture the active tab of the panel's window as a PNG data URL. Errors are returned,
 *  not thrown, so the panel can show the real reason (quota, restricted page, …). */
export async function brokerCapture(api: CaptureApi, msg: CaptureRequest): Promise<CaptureResult> {
  try {
    const dataUrl = await api.captureVisibleTab(msg.windowId, { format: 'png' });
    return { kind: 'capture-result', dataUrl };
  } catch (err) {
    return { kind: 'capture-result', dataUrl: null, error: err instanceof Error ? err.message : String(err) };
  }
}
