// `defineContentScript` and `browser` are WXT auto-imported globals (as in Plan 1's background.ts).
import { adapterFor } from '../src/lib/adapters/registry';
import { runContentDriver } from '../src/lib/contentDriver';
import type { ExtMessage, PositionMessage, AdapterStatusMessage } from '../src/lib/messages';

export default defineContentScript({
  matches: ['*://*.chess.com/*', '*://lichess.org/*'],
  main() {
    const adapter = adapterFor(location.href);
    if (!adapter) return;
    const driver = runContentDriver(adapter, (m: PositionMessage | AdapterStatusMessage) => {
      browser.runtime.sendMessage(m).catch(() => {}); // panel may be closed
    });
    // The panel asks for the current position when it opens / the tab activates /
    // Capture is clicked — pushes alone would leave it blank until the next move.
    browser.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
      if (msg?.kind !== 'position-request') return;
      sendResponse(driver.readNow());
    });
  },
});
