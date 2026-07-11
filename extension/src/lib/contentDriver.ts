import type { SiteAdapter } from './adapters/types';
import type { PositionMessage, AdapterStatusMessage } from './messages';

type Out = PositionMessage | AdapterStatusMessage;

/** Read once, then on every observed change; emit a PositionMessage per new FEN.
 *  When the board element is present but unreadable, emit adapter-status ok:false
 *  (once, on transition); clear it with ok:true when a read recovers.
 *  Returns a stop() that tears down the observer. */
export function runContentDriver(adapter: SiteAdapter, send: (m: Out) => void): () => void {
  let lastFen: string | null = null;
  let adapterOk = true; // start optimistic; only announce a *problem* or its recovery
  const emit = () => {
    const pos = adapter.readPosition();
    if (!pos) {
      if (adapter.boardPresent() && adapterOk) { adapterOk = false; send({ kind: 'adapter-status', site: adapter.site, ok: false }); }
      return;
    }
    if (!adapterOk) { adapterOk = true; send({ kind: 'adapter-status', site: adapter.site, ok: true }); }
    if (pos.fen === lastFen) return;
    lastFen = pos.fen;
    send({ kind: 'position', site: adapter.site, ...pos });
  };
  emit();
  return adapter.observe(emit);
}
