import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core: capture invoke calls; Channel is a plain object whose
// onmessage we can fire to simulate engine stdout.
// vi.hoisted() is required because vi.mock factories are hoisted above module-level
// declarations; `class` and `const` have TDZ, so we must hoist them explicitly.
const { invokeMock, FakeChannel } = vi.hoisted(() => {
  const invokeMock = vi.fn(async (..._args: unknown[]): Promise<void> => {});
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
  invokeMock.mockImplementation(async (...a: unknown[]) => {
    const cmd = a[0] as string;
    const args = a[1] as { onLine?: { onmessage?: (m: string) => void } } | undefined;
    if (cmd === 'engine_start') queueMicrotask(() => args?.onLine?.onmessage?.('uciok'));
  });
}

describe('loadNativeEngine', () => {
  it('starts the bundled engine, resolves on uciok, and routes lines to onLine', async () => {
    autoUciok();
    const engine = await loadNativeEngine({ kind: 'bundled' });
    expect(invokeMock).toHaveBeenCalledWith('engine_start', expect.objectContaining({ spec: { kind: 'bundled' } }));

    const lines: string[] = [];
    engine.onLine((l) => lines.push(l));
    const startArgs = invokeMock.mock.calls.find((c) => c[0] === 'engine_start')![1] as { onLine: InstanceType<typeof Channel> & { onmessage: (m: string) => void } };
    const ch = startArgs.onLine;
    ch.onmessage('info depth 1 score cp 20\nbestmove e2e4');
    expect(lines).toEqual(['info depth 1 score cp 20', 'bestmove e2e4']);
  });

  it('forwards an external engine spec to engine_start', async () => {
    autoUciok();
    await loadNativeEngine({ kind: 'external', path: '/opt/engines/foo' });
    expect(invokeMock).toHaveBeenCalledWith(
      'engine_start',
      expect.objectContaining({ spec: { kind: 'external', path: '/opt/engines/foo' } }),
    );
  });

  it('send() forwards a UCI line via engine_send', async () => {
    autoUciok();
    const engine = await loadNativeEngine({ kind: 'bundled' });
    invokeMock.mockClear();
    engine.send('go depth 12');
    expect(invokeMock).toHaveBeenCalledWith('engine_send', { line: 'go depth 12' });
  });

  it('dispose() calls engine_stop', async () => {
    autoUciok();
    const engine = await loadNativeEngine({ kind: 'bundled' });
    invokeMock.mockClear();
    engine.dispose();
    expect(invokeMock).toHaveBeenCalledWith('engine_stop');
  });

  it('captures advertised options during the handshake', async () => {
    invokeMock.mockImplementation(async (...a: unknown[]) => {
      const cmd = a[0] as string;
      const args = a[1] as { onLine?: { onmessage?: (m: string) => void } } | undefined;
      if (cmd === 'engine_start') queueMicrotask(() => {
        args?.onLine?.onmessage?.('option name Threads type spin default 1 min 1 max 8\nuciok');
      });
    });
    const engine = await loadNativeEngine({ kind: 'bundled' });
    expect(engine.options).toEqual([{ name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 }]);
  });

  it('rejects after timeoutMs if uciok never arrives, and stops the engine', async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined); // engine_start resolves but no uciok ever comes
    const p = loadNativeEngine({ kind: 'bundled' }, 500);
    // Register the rejection handler BEFORE advancing timers to avoid a momentary unhandled-rejection warning.
    const assertion = expect(p).rejects.toThrow('native engine failed to initialize within 500ms');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(invokeMock).toHaveBeenCalledWith('engine_stop');
    vi.useRealTimers();
  });
});
