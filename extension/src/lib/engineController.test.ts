import { describe, it, expect, vi } from 'vitest';
import { createEngineController } from './engineController';
import type { UciEngine } from '@chessmenthol/core/engine/engine';
import { setOption as storeSetOption, resetAll as storeResetAll } from '@chessmenthol/core/lib/engineOptions';
import type { UciOption } from '@chessmenthol/core/engine/uciOptions';

function fakeEngine(): UciEngine {
  return { send: vi.fn(), onLine: vi.fn(), dispose: vi.fn(), options: [] };
}

describe('createEngineController', () => {
  it('loads the engine once and caches it', async () => {
    const load = vi.fn(async () => fakeEngine());
    const ctrl = createEngineController(load);
    const a = await ctrl.ensureEngine();
    const b = await ctrl.ensureEngine();
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    expect(ctrl.currentEngine()).toBe(a);
  });

  it('setOption forwards to the live engine and is a no-op before load', () => {
    const ctrl = createEngineController(async () => fakeEngine());
    ctrl.setOption('Threads', '2'); // no engine yet -> no throw
    expect(ctrl.currentEngine()).toBeNull();
  });

  it('dispose() releases the engine and lets it reload', async () => {
    const load = vi.fn(async () => fakeEngine());
    const ctrl = createEngineController(load);
    const first = await ctrl.ensureEngine();
    ctrl.dispose();
    expect(ctrl.currentEngine()).toBeNull();
    const second = await ctrl.ensureEngine();
    expect(second).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('engineController option replay on load', () => {
  it('applies stored MultiPV override when the engine loads', async () => {
    storeResetAll('stockfish');
    storeSetOption('stockfish', 'MultiPV', '3'); // set BEFORE any engine exists
    const sent: string[] = [];
    const multipv: UciOption = { name: 'MultiPV', type: 'spin', default: '1', min: 1, max: 5 };
    const fakeEngine = { send: (c: string) => sent.push(c), onLine() {}, dispose() {}, options: [multipv] };

    const { createEngineController } = await import('./engineController');
    const ctrl = createEngineController(async () => fakeEngine);
    await ctrl.ensureEngine();

    expect(sent).toContain('setoption name MultiPV value 3');
    storeResetAll('stockfish');
  });
});
