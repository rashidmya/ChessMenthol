import type { EvalDto } from './types';

/** White's share of the eval bar (0..100). Logistic squash of centipawns;
 *  mate clamps to the extremes. */
export function whitePct(ev: EvalDto | null): number {
  if (!ev) return 50;
  if (ev.mate != null) return ev.mate > 0 ? 100 : 0;
  const cp = ev.cp ?? 0;
  const pct = 50 + 50 * (2 / (1 + Math.exp(-cp / 400)) - 1);
  return Math.max(2, Math.min(98, pct));
}

/** '1/2-1/2' → '½', otherwise the raw result string. */
export function resultText(r: string): string { return r === '1/2-1/2' ? '½' : r; }

/** White's eval-bar share for a finished game. */
export function resultPct(r: string): number { return r === '1-0' ? 100 : r === '0-1' ? 0 : 50; }
