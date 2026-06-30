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
// which we mock to true — that would otherwise build a real `new Worker(...)`, unsupported under
// jsdom and would crash the import. Force hasNativeCapture() false so no Worker is created;
// engine SELECTION still uses the isTauri() mock above.
vi.mock('../lib/capture', () => ({ hasNativeCapture: () => false, Capturer: class {} }));

beforeEach(async () => {
  localStorage.clear(); // reset the engine registry between tests
  // engineController is a module singleton with a cached loadPromise; reset it so each
  // ensureEngine() actually re-runs load().
  const { engineController } = await import('../lib/engineClient');
  engineController.dispose();
  loadNativeEngine.mockClear();
  loadStockfish.mockClear();
  isTauriMock.mockReturnValue(true);
});

describe('engineController loader selection', () => {
  it('loads the bundled native sidecar under Tauri', async () => {
    const { engineController } = await import('../lib/engineClient');
    await engineController.ensureEngine();
    expect(loadNativeEngine).toHaveBeenCalledTimes(1);
    expect(loadNativeEngine).toHaveBeenCalledWith({ kind: 'bundled' });
    expect(loadStockfish).not.toHaveBeenCalled();
  });

  it('loads the wasm engine (loadStockfish) in a plain browser', async () => {
    isTauriMock.mockReturnValue(false);
    const { engineController } = await import('../lib/engineClient');
    await engineController.ensureEngine();
    expect(loadStockfish).toHaveBeenCalledTimes(1);
    expect(loadNativeEngine).not.toHaveBeenCalled();
  });

  it('passes an external engine path to the native loader', async () => {
    const { add } = await import('../lib/engineRegistry');
    add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/engines/foo' });
    const { engineController } = await import('../lib/engineClient');
    engineController.select('ext1');
    await engineController.ensureEngine();
    expect(loadNativeEngine).toHaveBeenCalledWith({ kind: 'external', path: '/opt/engines/foo' });
  });

  it('does not thread-clamp the native engine', async () => {
    // threadsAvailable() is mocked false (as on WebKitGTK); the native engine is a
    // separate process and must still get the configured Threads value, not clamped to 1.
    const { engineController } = await import('../lib/engineClient');
    engineController.configure({ threads: 4, hash: null });
    const engine = await engineController.ensureEngine();
    expect(engine.send).toHaveBeenCalledWith('setoption name Threads value 4');
    expect(engine.send).not.toHaveBeenCalledWith('setoption name Threads value 1');
  });

  it('keeps the live engine when re-selecting the same id', async () => {
    const { engineController } = await import('../lib/engineClient');
    const a = await engineController.ensureEngine();
    engineController.select('stockfish'); // same as the default desiredId
    expect(loadNativeEngine).toHaveBeenCalledTimes(1); // no reload
    expect(engineController.currentEngine()).toBe(a);
    expect(a.dispose).not.toHaveBeenCalled();
  });

  it('disposes + reloads when switching to a different engine id', async () => {
    const { add } = await import('../lib/engineRegistry');
    add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/engines/foo' });
    const { engineController } = await import('../lib/engineClient');
    const a = await engineController.ensureEngine(); // bundled
    expect(loadNativeEngine).toHaveBeenCalledTimes(1);
    engineController.select('ext1'); // different id → drop + reload
    expect(a.dispose).toHaveBeenCalled();
    expect(engineController.currentEngine()).toBeNull();
    const b = await engineController.ensureEngine();
    expect(loadNativeEngine).toHaveBeenCalledTimes(2);
    expect(b).not.toBe(a);
  });

  it('self-heals to the new id when select() happens mid-load', async () => {
    const { add } = await import('../lib/engineRegistry');
    add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/engines/foo' });
    const { engineController } = await import('../lib/engineClient');

    const bundledEngine = { send: vi.fn(), onLine: vi.fn(), dispose: vi.fn() };
    const externalEngine = { send: vi.fn(), onLine: vi.fn(), dispose: vi.fn() };
    let resolveFirst!: (e: typeof bundledEngine) => void;
    loadNativeEngine
      .mockImplementationOnce(() => new Promise<typeof bundledEngine>((res) => { resolveFirst = res; })) // bundled load, deferred
      .mockImplementationOnce(async () => externalEngine); // ext1 load, immediate

    const p = engineController.ensureEngine();   // starts load('stockfish'), in flight
    engineController.select('ext1');             // switch mid-load → desiredId = 'ext1'
    resolveFirst(bundledEngine);                 // first load resolves to the wrong id → dispose + reload ext1
    const engine = await p;

    expect(bundledEngine.dispose).toHaveBeenCalled();
    expect(loadNativeEngine).toHaveBeenNthCalledWith(2, { kind: 'external', path: '/opt/engines/foo' });
    expect(engine).toBe(externalEngine);
    expect(engineController.currentEngine()).toBe(externalEngine);
  });
});
