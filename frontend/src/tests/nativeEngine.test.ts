import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core: capture invoke calls; Channel is a plain object whose
// onmessage we can fire to simulate engine stdout.
// vi.hoisted() is required because vi.mock factories are hoisted above module-level
// declarations; `class` and `const` have TDZ, so we must hoist them explicitly.
const { invokeMock, FakeChannel } = vi.hoisted(() => {
  const invokeMock = vi.fn(async () => {});
  class FakeChannel { onmessage: ((m: string) => void) | null = null; }
  return { invokeMock, FakeChannel };
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
  Channel: FakeChannel,
}));

import { loadNativeEngine } from '../engine/nativeEngine';
import { Channel } from '@tauri-apps/api/core';

beforeEach(() => invokeMock.mockClear());

// Resolve loadNativeEngine by making engine_start fire `uciok` through the channel.
function autoUciok() {
  invokeMock.mockImplementation(async (cmd: string, args: { onLine?: { onmessage?: (m: string) => void } }) => {
    if (cmd === 'engine_start') queueMicrotask(() => args.onLine?.onmessage?.('uciok'));
  });
}

describe('loadNativeEngine', () => {
  it('starts the engine, resolves on uciok, and routes lines to onLine', async () => {
    autoUciok();
    const engine = await loadNativeEngine('sf18');
    expect(invokeMock).toHaveBeenCalledWith('engine_start', expect.objectContaining({ engineId: 'sf18' }));

    const lines: string[] = [];
    engine.onLine((l) => lines.push(l));
    // Grab the channel passed to engine_start and push a batched message.
    const ch = invokeMock.mock.calls.find((c) => c[0] === 'engine_start')![1].onLine as InstanceType<typeof Channel> & { onmessage: (m: string) => void };
    ch.onmessage('info depth 1 score cp 20\nbestmove e2e4');
    expect(lines).toEqual(['info depth 1 score cp 20', 'bestmove e2e4']);
  });

  it('send() forwards a UCI line via engine_send', async () => {
    autoUciok();
    const engine = await loadNativeEngine('sf18');
    invokeMock.mockClear();
    engine.send('go depth 12');
    expect(invokeMock).toHaveBeenCalledWith('engine_send', { line: 'go depth 12' });
  });

  it('dispose() calls engine_stop', async () => {
    autoUciok();
    const engine = await loadNativeEngine('sf18');
    invokeMock.mockClear();
    engine.dispose();
    expect(invokeMock).toHaveBeenCalledWith('engine_stop');
  });

  it('rejects after timeoutMs if uciok never arrives, and stops the engine', async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined); // engine_start resolves but no uciok ever comes
    const p = loadNativeEngine('sf18', 500);
    // Attach the rejection handler BEFORE advancing timers so the timeout's
    // rejection is never momentarily unhandled (avoids a PromiseRejectionHandled warning).
    const assertion = expect(p).rejects.toThrow('native engine failed to initialize within 500ms');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(invokeMock).toHaveBeenCalledWith('engine_stop');
    vi.useRealTimers();
  });
});
