import type { ClassificationDto } from './types';

const MAP: Record<string, string> = {
  blunder: 'blun', mistake: 'mist', inaccuracy: 'inacc',
  good: 'good', excellent: 'good', best: 'best', great: 'best',
  brilliant: 'brill', book: '', miss: 'mist',
};

export function moveClass(c: ClassificationDto | null): string {
  return c ? (MAP[c.label] ?? '') : '';
}
