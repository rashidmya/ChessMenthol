import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// On Android, loadEngine() routes to the Kotlin `engine` plugin via app commands:
// mobile_engine_start/send/stop plus mobile_engine_poll, which drains buffered stdout
// lines (push events are ACL-gated, so we poll). isMobile() (real, via ../lib/platform)
// reads the mocked isTauri()+platform().
const { invokeMock, platformMock, isTauriMock } = vi.hoisted(() => {
  const invokeMock = vi.fn(async (..._a: unknown[]) => undefined as unknown);
  const platformMock = vi.fn(() => 'android');
  const isTauriMock = vi.fn(() => true);
  return { invokeMock, platformMock, isTauriMock };
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
  isTauri: () => isTauriMock(),
  Channel: class { onmessage: ((m: string) => void) | null = null; },
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => platformMock() }));

import { loadEngine } from '../engine/nativeEngine';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  platformMock.mockReturnValue('android');
  isTauriMock.mockReturnValue(true);
});
afterEach(() => vi.useRealTimers());

// Wire the mocked commands: `mobile_engine_poll` drains a queue; sending `uci` enqueues
// `uciok` so the handshake completes. Returns the queue so tests can enqueue more lines.
function withPollQueue(): string[] {
  const queue: string[] = [];
  invokeMock.mockImplementation(async (...a: unknown[]) => {
    const cmd = a[0] as string;
    const args = a[1] as { line?: string } | undefined;
    if (cmd === 'mobile_engine_send' && args?.line === 'uci') queue.push('uciok');
    if (cmd === 'mobile_engine_poll') return queue.splice(0);
    return undefined;
  });
  return queue;
}

describe('loadEngine on Android (polling bridge)', () => {
  it('starts, polls for uciok, and streams polled lines to onLine', async () => {
    vi.useFakeTimers();
    const queue = withPollQueue();
    const p = loadEngine({ kind: 'bundled' });
    await vi.advanceTimersByTimeAsync(200); // let polls deliver uciok
    const engine = await p;
    expect(invokeMock).toHaveBeenCalledWith('mobile_engine_start');

    const lines: string[] = [];
    engine.onLine((l) => lines.push(l));
    queue.push('info depth 1 score cp 20', 'bestmove e2e4');
    await vi.advanceTimersByTimeAsync(100);
    expect(lines).toEqual(['info depth 1 score cp 20', 'bestmove e2e4']);
  });

  it('send() forwards a UCI line via mobile_engine_send', async () => {
    vi.useFakeTimers();
    withPollQueue();
    const p = loadEngine({ kind: 'bundled' });
    await vi.advanceTimersByTimeAsync(200);
    const engine = await p;
    engine.send('go movetime 1000');
    expect(invokeMock).toHaveBeenCalledWith('mobile_engine_send', { line: 'go movetime 1000' });
  });

  it('dispose() stops the engine and halts polling', async () => {
    vi.useFakeTimers();
    withPollQueue();
    const p = loadEngine({ kind: 'bundled' });
    await vi.advanceTimersByTimeAsync(200);
    const engine = await p;
    engine.dispose();
    expect(invokeMock).toHaveBeenCalledWith('mobile_engine_stop');
    const callsAfterDispose = invokeMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300);
    expect(invokeMock.mock.calls.length).toBe(callsAfterDispose); // no more polls
  });

  it('delegates to the desktop native path when platform is not mobile', async () => {
    platformMock.mockReturnValue('linux');
    invokeMock.mockImplementation(async (...a: unknown[]) => {
      const cmd = a[0] as string;
      const args = a[1] as { onLine?: { onmessage?: (m: string) => void } } | undefined;
      if (cmd === 'engine_start') queueMicrotask(() => args?.onLine?.onmessage?.('uciok'));
      return undefined;
    });
    await loadEngine({ kind: 'bundled' });
    expect(invokeMock).toHaveBeenCalledWith('engine_start', expect.objectContaining({ spec: { kind: 'bundled' } }));
    expect(invokeMock).not.toHaveBeenCalledWith('mobile_engine_start');
  });
});
