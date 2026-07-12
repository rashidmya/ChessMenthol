import { describe, it, expect } from 'vitest';
import { moveToUci } from '../lib/board';

describe('moveToUci', () => {
  it('joins origin and destination squares', () => {
    expect(moveToUci('e2', 'e4')).toBe('e2e4');
  });
  it('appends a promotion piece when provided, else joins plainly', () => {
    expect(moveToUci('e7', 'e8', 'q')).toBe('e7e8q');
    expect(moveToUci('e7', 'e8', 'n')).toBe('e7e8n');
    expect(moveToUci('e7', 'e8')).toBe('e7e8');
  });
});
