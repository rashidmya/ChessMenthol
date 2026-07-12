import type { ExtMessage, CaptureResult } from '../src/lib/messages';

export default defineBackground({
  main() {
    // Let clicking the toolbar icon open the side panel (Chrome). On Firefox the
    // sidebar toggles via the browser action automatically. `sidePanel` is typed
    // as always-present by WXT's merged browser types (it's Chrome-only at
    // runtime), so this is guarded with optional chaining rather than a
    // `@ts-expect-error` (which would be an unused-directive error here).
    browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

    // Broker for the panel's vision path: the panel has no tab context of its own,
    // so it asks the background (which does) to grab the visible tab as a PNG.
    browser.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
      if (msg?.kind !== 'capture-request') return;
      // Capture the active tab of the current window as a PNG data URL.
      browser.tabs
        .captureVisibleTab(undefined as never, { format: 'png' })
        .then((dataUrl) => sendResponse({ kind: 'capture-result', dataUrl } satisfies CaptureResult))
        .catch((err) => sendResponse({ kind: 'capture-result', dataUrl: null, error: String(err) } satisfies CaptureResult));
      return true; // keep the message channel open for the async sendResponse
    });
  },
});
