// `defineContentScript` and `browser` are WXT auto-imported globals (as in Plan 1's background.ts).
import { adapterFor } from '../src/lib/adapters/registry';
import { runContentDriver } from '../src/lib/contentDriver';
import type { PositionMessage, AdapterStatusMessage } from '../src/lib/messages';

export default defineContentScript({
  matches: ['*://*.chess.com/*', '*://lichess.org/*'],
  main() {
    const adapter = adapterFor(location.href);
    if (!adapter) return;
    runContentDriver(adapter, (m: PositionMessage | AdapterStatusMessage) => {
      browser.runtime.sendMessage(m).catch(() => {}); // panel may be closed
    });
  },
});
