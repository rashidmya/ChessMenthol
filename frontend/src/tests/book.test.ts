import { describe, it, expect } from 'vitest';
import { NoBook } from '../core/book';
import { posFromFen } from '../core/chess';

describe('NoBook', () => {
  it('never contains any move', () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const pos = posFromFen(startFen);
    const book = new NoBook();

    expect(book.containsMove(pos, 'e2e4')).toBe(false);
    expect(book.containsMove(pos, 'd2d4')).toBe(false);
  });
});
