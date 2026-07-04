import type { SiteAdapter } from './types';
import { chesscomAdapter } from './chesscom';
import { lichessAdapter } from './lichess';

const ADAPTERS: SiteAdapter[] = [chesscomAdapter, lichessAdapter];

/** The first adapter whose `matches(url)` is true, or null. */
export function adapterFor(url: string): SiteAdapter | null {
  return ADAPTERS.find((a) => a.matches(url)) ?? null;
}
