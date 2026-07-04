import type { SiteAdapter } from './adapters/types';
import type { PositionMessage } from './messages';

/** Read once, then on every observed change; emit a PositionMessage per new FEN.
 *  Returns a stop() that tears down the observer. */
export function runContentDriver(adapter: SiteAdapter, send: (m: PositionMessage) => void): () => void {
  let lastFen: string | null = null;
  const emit = () => {
    const pos = adapter.readPosition();
    if (!pos || pos.fen === lastFen) return;
    lastFen = pos.fen;
    send({ kind: 'position', site: adapter.site, ...pos });
  };
  emit();
  return adapter.observe(emit);
}
