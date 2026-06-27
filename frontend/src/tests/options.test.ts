import { it, expect } from 'vitest';
import { SEARCH_TIMES, MEMORY_MB, searchLabel, memoryLabel } from '../lib/options';

it('maps search-time slider index to ms (null = infinite)', () => {
  expect(SEARCH_TIMES.map((s) => s.ms)).toEqual([2000, 5000, 10000, 20000, 30000, null]);
  expect(searchLabel(2)).toBe('10s');
  expect(searchLabel(5)).toBe('∞');
});
it('maps memory slider index to MB', () => {
  expect(MEMORY_MB).toEqual([16, 32, 64, 128, 256, 512]);
  expect(memoryLabel(4)).toBe('256MB');
});
