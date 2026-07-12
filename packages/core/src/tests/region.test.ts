import { describe, it, expect } from 'vitest';
import { toDesktopRegion, captureCommands } from '../lib/region';

const displayed = { width: 1000, height: 500 };
const real = { width: 2000, height: 1000 };

describe('toDesktopRegion', () => {
  it('scales a forward drag to true desktop pixels', () => {
    const r = toDesktopRegion({ x: 100, y: 50, w: 200, h: 100 }, displayed, real);
    expect(r).toEqual({ left: 200, top: 100, width: 400, height: 200 });
  });

  it('normalizes a reversed (up-left) drag', () => {
    const r = toDesktopRegion({ x: 300, y: 150, w: -200, h: -100 }, displayed, real);
    expect(r).toEqual({ left: 200, top: 100, width: 400, height: 200 });
  });

  it('clamps a drag that runs off the edge', () => {
    const r = toDesktopRegion({ x: 900, y: 450, w: 400, h: 400 }, displayed, real);
    expect(r).toEqual({ left: 1800, top: 900, width: 200, height: 100 });
  });
});

describe('captureCommands', () => {
  it('sets the region then captures, in order', () => {
    expect(captureCommands({ left: 1, top: 2, width: 3, height: 4 })).toEqual([
      { type: 'set_region', left: 1, top: 2, width: 3, height: 4 },
      { type: 'capture_now' },
    ]);
  });
});
