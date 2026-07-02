import { describe, it, expect } from 'vitest';
import { linesToShapes, type ArrowLine } from '../lib/arrows';

const line = (pv: string[], cp: number | null, mate: number | null = null): ArrowLine => ({ pv, cp, mate });

describe('linesToShapes', () => {
  it('returns no shapes when arrows are hidden', () => {
    expect(linesToShapes([line(['e2e4'], 30)], false)).toEqual([]);
  });

  it('returns no shapes when there are no lines', () => {
    expect(linesToShapes([], true)).toEqual([]);
  });

  it('draws the best move as a bold blue arrow with no width override', () => {
    expect(linesToShapes([line(['e2e4'], 30)], true, 'white')).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'paleBlue' },
    ]);
  });

  it('draws an equally-good second line as full-width grey', () => {
    const shapes = linesToShapes([line(['e2e4'], 30), line(['d2d4'], 30)], true, 'white');
    expect(shapes).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'paleBlue' },
      { orig: 'd2', dest: 'd4', brush: 'paleGrey', modifiers: { lineWidth: 12 } },
    ]);
  });

  it('thins a weaker line in proportion to the win-chance it gives up', () => {
    // best +0.30, alt -0.50 (White POV), White to move -> ~0.073 win-chance behind -> width 8
    const shapes = linesToShapes([line(['e2e4'], 30), line(['d2d4'], -50)], true, 'white');
    expect(shapes[1]).toEqual({ orig: 'd2', dest: 'd4', brush: 'paleGrey', modifiers: { lineWidth: 8 } });
  });

  it('drops a line that is more than ~0.2 win-chance behind the best', () => {
    const shapes = linesToShapes([line(['e2e4'], 900), line(['d2d4'], -900)], true, 'white');
    expect(shapes).toEqual([{ orig: 'e2', dest: 'e4', brush: 'paleBlue' }]);
  });

  it('reads evals from the mover POV when Black is to move', () => {
    // White-POV cp: best -30 (good for Black), alt +50 (bad for Black). With the
    // POV flip this is the same 0.073 gap -> width 8; without it the line would
    // look "ahead" and be dropped.
    const shapes = linesToShapes([line(['e7e5'], -30), line(['d7d5'], 50)], true, 'black');
    expect(shapes[1]).toEqual({ orig: 'd7', dest: 'd5', brush: 'paleGrey', modifiers: { lineWidth: 8 } });
  });

  it('uses mate scores too, keeping the mating line a thick arrow', () => {
    const shapes = linesToShapes([line(['e2e4'], null, 1), line(['d2d4'], null, 2)], true, 'white');
    expect(shapes[0]).toEqual({ orig: 'e2', dest: 'e4', brush: 'paleBlue' });
    expect(shapes[1].brush).toBe('paleGrey');
    expect(shapes[1].modifiers!.lineWidth).toBeGreaterThanOrEqual(2);
    expect(shapes[1].modifiers!.lineWidth).toBeLessThanOrEqual(12);
  });

  it('skips lines with an empty pv but still draws the rest', () => {
    expect(linesToShapes([line([], 30), line(['g1f3'], 20)], true, 'white')).toEqual([
      { orig: 'g1', dest: 'f3', brush: 'paleGrey', modifiers: { lineWidth: 12 } },
    ]);
  });
});
