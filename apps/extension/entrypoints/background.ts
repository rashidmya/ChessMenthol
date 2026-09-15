import type { ExtMessage } from '../src/lib/messages';
import { brokerCapture } from '../src/lib/captureBroker';

export default defineBackground({
  main() {
    // Let clicking the toolbar icon open the side panel (Chrome). On Firefox the
    // sidebar toggles via the browser action automatically. `sidePanel` is typed
    // as always-present by WXT's merged browser types (it's Chrome-only at
    // runtime), so this is guarded with optional chaining rather than a
    // `@ts-expect-error` (which would be an unused-directive error here).
    browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

    // Broker for the panel's vision path: the panel has no tab context of its own,
    // so it asks the background (which does) to grab the visible tab as a PNG. The
    // request carries the panel's windowId so a second browser window can't be the
    // one captured.
    browser.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
      if (msg?.kind !== 'capture-request') return;
      void brokerCapture(browser.tabs, msg).then(sendResponse);
      return true; // keep the message channel open for the async sendResponse
    });
  },
});
