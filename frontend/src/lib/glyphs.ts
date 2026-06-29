export type GlyphKind = 'text' | 'star' | 'thumb' | 'check' | 'cross' | 'book';

export interface GlyphSpec {
  kind: GlyphKind;
  /** Text glyph drawn when kind === 'text' (e.g. '!!'); '' for drawn kinds. */
  symbol: string;
  color: string;
}

/** Single source of truth for move-quality badge artwork, keyed by the backend
 *  MoveClass value from the original Python chessmenthol/analysis/classify.py (removed in the Svelte+Tauri migration). Colors/symbols live ONLY
 *  here — components read from this map, never hard-code their own. */
export const GLYPHS: Record<string, GlyphSpec> = {
  brilliant:  { kind: 'text',  symbol: '!!', color: '#1aa99c' },
  great:      { kind: 'text',  symbol: '!',  color: '#5a87b0' },
  best:       { kind: 'star',  symbol: '',   color: '#7cab3e' },
  excellent:  { kind: 'thumb', symbol: '',   color: '#95b94a' },
  good:       { kind: 'check', symbol: '',   color: '#b0b35c' },
  book:       { kind: 'book',  symbol: '',   color: '#a98863' },
  inaccuracy: { kind: 'text',  symbol: '?!', color: '#efbf3b' },
  mistake:    { kind: 'text',  symbol: '?',  color: '#e58f2a' },
  miss:       { kind: 'cross', symbol: '',   color: '#d76b3a' },
  blunder:    { kind: 'text',  symbol: '??', color: '#f7402d' },
};

/** Neutral fallback so an unexpected label never crashes the UI. */
const FALLBACK: GlyphSpec = { kind: 'text', symbol: '·', color: '#8a8a8a' };

export function glyphFor(label: string): GlyphSpec {
  return GLYPHS[label] ?? FALLBACK;
}
