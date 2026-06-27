import type { ClassificationDto } from './types';

// 'inacc' (inaccuracy) and 'brill' (brilliant) intentionally have no CSS color
// rule in MoveHistory.svelte — the mockup leaves those move classes uncolored,
// so a future reader shouldn't go hunting for missing styles.
const MAP: Record<string, string> = {
  blunder: 'blun', mistake: 'mist', inaccuracy: 'inacc',
  good: 'good', excellent: 'good', best: 'best', great: 'best',
  brilliant: 'brill', book: '', miss: 'mist',
};

export function moveClass(c: ClassificationDto | null): string {
  return c ? (MAP[c.label] ?? '') : '';
}
