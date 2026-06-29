// frontend/src/engine/nativeEngine.ts
// UciEngine implementation backed by the native Stockfish sidecar (Tauri only).
// Mirrors WorkerEngine's contract: resolves once the engine answers `uciok`, splits
// batched output into trimmed lines, and routes them to the registered listener.
import { invoke, Channel } from '@tauri-apps/api/core';
import type { UciEngine } from './engine';

export async function loadNativeEngine(engineId: string, timeoutMs = 10_000): Promise<UciEngine> {
  let listener: ((line: string) => void) | null = null;
  // Buffer lines that arrive before onLine() is called (e.g. uciok from engine_start).
  const lineBuffer: string[] = [];

  const channel = new Channel<string>();
  channel.onmessage = (chunk: string) => {
    for (const raw of String(chunk).split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (listener) {
        listener(line);
      } else {
        lineBuffer.push(line);
      }
    }
  };

  await invoke('engine_start', { engineId, onLine: channel });

  const engine: UciEngine = {
    send: (cmd: string) => { void invoke('engine_send', { line: cmd }); },
    onLine: (cb: (line: string) => void) => {
      listener = cb;
      // Flush lines that arrived before the listener was registered.
      for (const line of lineBuffer) cb(line);
      lineBuffer.length = 0;
    },
    dispose: () => { void invoke('engine_stop'); },
  };

  // Handshake: send `uci`, resolve on `uciok`, reject if the engine never initializes.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      engine.dispose();
      reject(new Error(`native engine failed to initialize within ${timeoutMs}ms`));
    }, timeoutMs);
    engine.onLine((line: string) => { if (line === 'uciok') { clearTimeout(timer); resolve(); } });
    engine.send('uci');
  });

  return engine;
}
