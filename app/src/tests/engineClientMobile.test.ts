import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mobile controller behaviour: platform() reports 'android', so engineClient seeds
// conservative Threads/Hash defaults unless the user already set them.
const { loadEngine, isTauriMock } = vi.hoisted(() => {
  const fakeEngine = (options: unknown[] = []) => ({ send: vi.fn(), onLine: vi.fn(), dispose: vi.fn(), options });
  return {
    loadEngine: vi.fn(async (..._a: unknown[]) => fakeEngine([
      { name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 },
      { name: 'Hash', type: 'spin', default: '16', min: 1, max: 1024 },
      { name: 'MultiPV', type: 'spin', default: '1', min: 1, max: 5 },
    ])),
    isTauriMock: vi.fn(() => true),
  };
});
vi.mock('../engine/nativeEngine', () => ({ loadEngine: (...a: unknown[]) => loadEngine(...a) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => isTauriMock(), Channel: class {} }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'android' }));
vi.mock('../lib/capture', () => ({ hasNativeCapture: () => false, Capturer: class {} }));

beforeEach(async () => {
  localStorage.clear();
  const { engineController } = await import('../lib/engineClient');
  engineController.dispose();
  loadEngine.mockClear();
  isTauriMock.mockReturnValue(true);
});

describe('engineController on mobile', () => {
  it('seeds conservative Threads/Hash defaults when the user has not set them', async () => {
    const { engineController } = await import('../lib/engineClient');
    const engine = await engineController.ensureEngine();
    expect(engine.send).toHaveBeenCalledWith('setoption name Threads value 2');
    expect(engine.send).toHaveBeenCalledWith('setoption name Hash value 64');
  });

  it('does not override a user-set Threads on mobile', async () => {
    const { setOption } = await import('../lib/engineOptions');
    setOption('stockfish', 'Threads', '4');
    const { engineController } = await import('../lib/engineClient');
    const engine = await engineController.ensureEngine();
    expect(engine.send).toHaveBeenCalledWith('setoption name Threads value 4');
    expect(engine.send).not.toHaveBeenCalledWith('setoption name Threads value 2');
  });
});
