import type { ClassificationDto } from './types';
import { glyphFor } from './glyphs';

// The move-history list highlights only "notable" moves, matching Lichess's
// approach of never tinting a move just for being the engine's best/ordinary
// choice. We color the bad moves (inaccuracy/mistake/miss/blunder) and the two
// exceptional good ones (great/brilliant); best/good/excellent stay
// neutral. Colors come from glyphs.ts (the single source of truth) so the list
// matches the board badges.
const COLORED = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

/** Inline text color for a move-list entry, or null when the move should stay
 *  neutral (no classification, or an ordinary/best move we don't highlight). */
export function moveColor(c: ClassificationDto | null): string | null {
  return c && COLORED.has(c.label) ? glyphFor(c.label).color : null;
}
