import { describe, it, expect, vi } from 'vitest';
import { createEngineController } from './engineController';
import type { UciEngine } from '@core/engine/engine';

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
