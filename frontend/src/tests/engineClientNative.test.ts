import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above imports, so the vars they reference must be
// created inside vi.hoisted() (bare const/class would hit a TDZ error).
const { loadNativeEngine, loadStockfish, isTauriMock } = vi.hoisted(() => {
  const fakeEngine = () => ({ send: vi.fn(), onLine: vi.fn(), dispose: vi.fn() });
  return {
    loadNativeEngine: vi.fn(async (..._a: unknown[]) => fakeEngine()),
    loadStockfish: vi.fn(async (..._a: unknown[]) => fakeEngine()),
    isTauriMock: vi.fn(() => true),
  };
});

vi.mock('../engine/nativeEngine', () => ({ loadNativeEngine: (...a: unknown[]) => loadNativeEngine(...a) }));
vi.mock('../engine/engine', async (orig) => ({
  ...(await orig<typeof import('../engine/engine')>()),
  loadStockfish: (...a: unknown[]) => loadStockfish(...a),
  threadsAvailable: () => false,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => isTauriMock(), Channel: class {} }));
// engineClient.ts runs makeVisionTracker() at module load; hasNativeCapture() calls isTauri(),
// which we mock to true here — that would otherwise build a real `new Worker(...)`, unsupported
// under jsdom and would crash the import. Force hasNativeCapture() false so no Worker is created;
// engine SELECTION still uses the isTauri() mock above.
vi.mock('../lib/capture', () => ({ hasNativeCapture: () => false, Capturer: class {} }));

beforeEach(async () => {
  // engineController is a module singleton with a cached loadPromise; reset it between
  // tests so each ensureEngine() actually re-runs load() (mirrors engineReload.test.ts).
  const { engineController } = await import('../lib/engineClient');
  engineController.dispose();
  loadNativeEngine.mockClear();
  loadStockfish.mockClear();
});

describe('engineController loader selection', () => {
  it('uses the native engine under Tauri', async () => {
    isTauriMock.mockReturnValue(true);
    const { engineController } = await import('../lib/engineClient');
    await engineController.ensureEngine();
    expect(loadNativeEngine).toHaveBeenCalledTimes(1);
    expect(loadStockfish).not.toHaveBeenCalled();
  });

  it('uses the wasm engine (loadStockfish) in a plain browser', async () => {
    isTauriMock.mockReturnValue(false);
    const { engineController } = await import('../lib/engineClient');
    await engineController.ensureEngine();
    expect(loadStockfish).toHaveBeenCalledTimes(1);
    expect(loadNativeEngine).not.toHaveBeenCalled();
  });
});
