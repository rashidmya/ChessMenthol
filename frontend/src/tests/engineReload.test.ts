/**
 * src/tests/engineReload.test.ts
 *
 * The full and lite stockfish builds are DIFFERENT binaries, so switching
 * presets across families must DISPOSE the current worker and RELOAD the new
 * one (no in-place swap). This drives the engineController directly to lock in:
 *   - stockfish_lite loads the 'lite' variant
 *   - switching to stockfish disposes the lite worker and reloads 'full'
 *   - a same-variant select() keeps the live engine (no reload)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const loads: Array<{ variant: string; engine: FakeEngine }> = [];
class FakeEngine {
  disposed = false;
  send() {}
  onLine(_cb: (l: string) => void) {}
  configure() {}
  dispose() { this.disposed = true; }
}
vi.mock('../engine/engine', () => ({
  loadStockfish: vi.fn(async (variant: 'full' | 'lite' = 'lite') => {
    const engine = new FakeEngine();
    loads.push({ variant, engine });
    return engine;
  }),
  // engineClient imports `configure` + `threadsAvailable` from this module too.
  configure: () => {},
  threadsAvailable: () => false,
}));

import { engineController } from '../lib/engineClient';

beforeEach(() => { loads.length = 0; engineController.dispose(); });

describe('engine reload on variant switch', () => {
  it('loads lite for stockfish_lite, then disposes + reloads full for stockfish', async () => {
    engineController.select('stockfish_lite');
    const a = await engineController.ensureEngine();
    expect(loads.at(-1)!.variant).toBe('lite');

    engineController.select('stockfish');        // cross-variant → drop the lite engine
    expect((a as unknown as FakeEngine).disposed).toBe(true);
    const b = await engineController.ensureEngine();
    expect(loads.at(-1)!.variant).toBe('full');
    expect(b).not.toBe(a);
  });

  it('same-variant select does NOT reload', async () => {
    engineController.select('stockfish_lite');
    const a = await engineController.ensureEngine();
    engineController.select('stockfish_lite');   // same variant → keep engine
    expect((a as unknown as FakeEngine).disposed).toBe(false);
    const b = await engineController.ensureEngine();
    expect(b).toBe(a);
  });

  it('a cross-variant switch during an in-flight load resolves to the FINAL variant', async () => {
    engineController.select('stockfish');             // desire full
    const pending = engineController.ensureEngine();  // start loading full — do NOT await
    engineController.select('stockfish_lite');        // switch to lite mid-load
    const resolved = await pending;                   // the awaited promise self-heals to lite
    expect(loads.map((l) => l.variant)).toContain('lite');
    const full = loads.find((l) => l.variant === 'full');
    expect(full!.engine.disposed).toBe(true);         // superseded full binary disposed
    expect((resolved as unknown as FakeEngine).disposed).toBe(false);
    expect(loads.at(-1)!.variant).toBe('lite');       // ended on lite
  });
});
