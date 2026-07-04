import { describe, it, expect, vi, beforeEach } from 'vitest';

// On Android, loadEngine() routes to the Kotlin `engine` plugin: invoke
// plugin:engine|start|send|stop and stream stdout via addPluginListener('engine','line').
// isMobile() (real, via ../lib/platform) reads the mocked isTauri()+platform().
const { invokeMock, listeners, platformMock, isTauriMock } = vi.hoisted(() => {
  const invokeMock = vi.fn(async (..._a: unknown[]) => {});
  const listeners: Record<string, (p: { line: string }) => void> = {};
  const platformMock = vi.fn(() => 'android');
  const isTauriMock = vi.fn(() => true);
  return { invokeMock, listeners, platformMock, isTauriMock };
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
  isTauri: () => isTauriMock(),
  Channel: class { onmessage: ((m: string) => void) | null = null; },
  addPluginListener: async (_plugin: string, event: string, cb: (p: { line: string }) => void) => {
    listeners[event] = cb;
    return { unregister: async () => {} };
  },
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => platformMock() }));

import { loadEngine } from '../engine/nativeEngine';

beforeEach(() => {
  invokeMock.mockClear();
  platformMock.mockReturnValue('android');
  isTauriMock.mockReturnValue(true);
});

function fireLine(line: string) { listeners['line']?.({ line }); }

// Resolve the handshake by answering the plugin's `uci` with `uciok` on the line stream.
function autoUciok() {
  invokeMock.mockImplementation(async (...a: unknown[]) => {
    const cmd = a[0] as string;
    const args = a[1] as { line?: string } | undefined;
    if (cmd === 'plugin:engine|send' && args?.line === 'uci') queueMicrotask(() => fireLine('uciok'));
  });
}

describe('loadEngine on Android', () => {
  it('starts via the engine plugin, resolves on uciok, and streams lines to onLine', async () => {
    autoUciok();
    const engine = await loadEngine({ kind: 'bundled' });
    expect(invokeMock).toHaveBeenCalledWith('plugin:engine|start');

    const lines: string[] = [];
    engine.onLine((l) => lines.push(l));
    fireLine('info depth 1 score cp 20');
    fireLine('bestmove e2e4');
    expect(lines).toEqual(['info depth 1 score cp 20', 'bestmove e2e4']);
  });

  it('send() forwards a UCI line via the plugin', async () => {
    autoUciok();
    const engine = await loadEngine({ kind: 'bundled' });
    invokeMock.mockClear();
    engine.send('go movetime 1000');
    expect(invokeMock).toHaveBeenCalledWith('plugin:engine|send', { line: 'go movetime 1000' });
  });

  it('dispose() stops the plugin engine', async () => {
    autoUciok();
    const engine = await loadEngine({ kind: 'bundled' });
    invokeMock.mockClear();
    engine.dispose();
    expect(invokeMock).toHaveBeenCalledWith('plugin:engine|stop');
  });

  it('delegates to the desktop native path when platform is not mobile', async () => {
    platformMock.mockReturnValue('linux');
    invokeMock.mockImplementation(async (...a: unknown[]) => {
      const cmd = a[0] as string;
      const args = a[1] as { onLine?: { onmessage?: (m: string) => void } } | undefined;
      if (cmd === 'engine_start') queueMicrotask(() => args?.onLine?.onmessage?.('uciok'));
    });
    await loadEngine({ kind: 'bundled' });
    expect(invokeMock).toHaveBeenCalledWith('engine_start', expect.objectContaining({ spec: { kind: 'bundled' } }));
    expect(invokeMock).not.toHaveBeenCalledWith('plugin:engine|start');
  });
});
