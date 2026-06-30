import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadNativeEngine, loadStockfish, isTauriMock } = vi.hoisted(() => {
  const fakeEngine = (options: unknown[] = []) => ({ send: vi.fn(), onLine: vi.fn(), dispose: vi.fn(), options });
  return {
    loadNativeEngine: vi.fn(async (..._a: unknown[]) => fakeEngine([{ name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 }, { name: 'MultiPV', type: 'spin', default: '1', min: 1, max: 5 }])),
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
vi.mock('../lib/capture', () => ({ hasNativeCapture: () => false, Capturer: class {} }));

beforeEach(async () => {
  localStorage.clear();
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
    expect(loadNativeEngine).toHaveBeenCalledWith({ kind: 'bundled' });
    expect(loadStockfish).not.toHaveBeenCalled();
  });

  it('loads the wasm engine in a plain browser', async () => {
    isTauriMock.mockReturnValue(false);
    const { engineController } = await import('../lib/engineClient');
    await engineController.ensureEngine();
    expect(loadStockfish).toHaveBeenCalledTimes(1);
  });

  it('passes an external engine path to the native loader', async () => {
    const { add } = await import('../lib/engineRegistry');
    add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/engines/foo' });
    const { engineController } = await import('../lib/engineClient');
    engineController.select('ext1');
    await engineController.ensureEngine();
    expect(loadNativeEngine).toHaveBeenCalledWith({ kind: 'external', path: '/opt/engines/foo' });
  });

  it('caches the advertised schema and applies stored overrides on load', async () => {
    const { setOption } = await import('../lib/engineOptions');
    setOption('stockfish', 'MultiPV', '3'); // user override
    const { engineController } = await import('../lib/engineClient');
    const engine = await engineController.ensureEngine();
    const { getSchema } = await import('../lib/engineOptions');
    expect(getSchema('stockfish')?.some((o) => o.name === 'MultiPV')).toBe(true); // schema cached
    expect(engine.send).toHaveBeenCalledWith('setoption name MultiPV value 3');   // override applied
    expect(engine.send).not.toHaveBeenCalledWith('setoption name Threads value 1'); // no unchanged option sent
  });

  it('does not clamp Threads for the native engine', async () => {
    const { setOption } = await import('../lib/engineOptions');
    setOption('stockfish', 'Threads', '4');
    const { engineController } = await import('../lib/engineClient');
    const engine = await engineController.ensureEngine();
    expect(engine.send).toHaveBeenCalledWith('setoption name Threads value 4');
  });

  it('clamps Threads to 1 for single-threaded wasm (browser)', async () => {
    isTauriMock.mockReturnValue(false);
    const { setOption } = await import('../lib/engineOptions');
    // wasm engine advertises Threads so the schema knows the type
    loadStockfish.mockResolvedValueOnce({ send: vi.fn(), onLine: vi.fn(), dispose: vi.fn(), options: [{ name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 }] } as never);
    setOption('stockfish', 'Threads', '4');
    const { engineController } = await import('../lib/engineClient');
    const engine = await engineController.ensureEngine();
    expect(engine.send).toHaveBeenCalledWith('setoption name Threads value 1');
    expect(engine.send).not.toHaveBeenCalledWith('setoption name Threads value 4');
  });

  it('setOption sends a live change to the loaded engine', async () => {
    const { engineController } = await import('../lib/engineClient');
    const engine = await engineController.ensureEngine();
    (engine.send as ReturnType<typeof vi.fn>).mockClear();
    engineController.setOption('MultiPV', '2');
    expect(engine.send).toHaveBeenCalledWith('setoption name MultiPV value 2');
  });

  it('setOption with no value sends a valueless setoption (button)', async () => {
    const { engineController } = await import('../lib/engineClient');
    const engine = await engineController.ensureEngine();
    (engine.send as ReturnType<typeof vi.fn>).mockClear();
    engineController.setOption('Clear Hash');
    expect(engine.send).toHaveBeenCalledWith('setoption name Clear Hash');
  });

  it('self-heals to the newly selected engine when select() happens mid-load', async () => {
    const { add } = await import('../lib/engineRegistry');
    add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/engines/foo' });
    const { engineController } = await import('../lib/engineClient');

    // First load (bundled 'stockfish') hangs until we resolve it manually.
    let resolveFirst!: (e: unknown) => void;
    const firstEngine = { send: vi.fn(), onLine: vi.fn(), dispose: vi.fn(), options: [] };
    loadNativeEngine.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r as never; }));

    const pending = engineController.ensureEngine();   // starts loading 'stockfish'
    engineController.select('ext1');                    // switch engines mid-load
    resolveFirst(firstEngine);                          // the now-stale first load resolves
    const engine = await pending;

    expect(firstEngine.dispose).toHaveBeenCalled();                                   // stale engine disposed
    expect(loadNativeEngine).toHaveBeenLastCalledWith({ kind: 'external', path: '/opt/engines/foo' });
    expect(engine).not.toBe(firstEngine);              // caller received the healed (ext1) engine
  });

  it('disposes + reloads when switching to a different engine id', async () => {
    const { add } = await import('../lib/engineRegistry');
    add({ id: 'ext1', name: 'My Engine', kind: 'external', path: '/opt/engines/foo' });
    const { engineController } = await import('../lib/engineClient');
    const a = await engineController.ensureEngine();
    engineController.select('ext1');
    expect(a.dispose).toHaveBeenCalled();
    const b = await engineController.ensureEngine();
    expect(b).not.toBe(a);
  });
});
