import { describe, it, expect } from 'vitest';
import { linesToShapes } from '../lib/arrows';

describe('linesToShapes', () => {
  it('returns no shapes when arrows are hidden', () => {
    expect(linesToShapes([{ pv: ['e2e4'] }], false)).toEqual([]);
  });
  it('draws the best move in the strong brush', () => {
    expect(linesToShapes([{ pv: ['e2e4'] }], true)).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'green' },
    ]);
  });
  it('fades lower lines', () => {
    const shapes = linesToShapes([{ pv: ['e2e4'] }, { pv: ['d2d4'] }], true);
    expect(shapes).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'green' },
      { orig: 'd2', dest: 'd4', brush: 'paleBlue' },
    ]);
  });
  it('skips lines with an empty pv', () => {
    expect(linesToShapes([{ pv: [] }, { pv: ['g1f3'] }], true)).toEqual([
      { orig: 'g1', dest: 'f3', brush: 'paleBlue' },
    ]);
  });
});
