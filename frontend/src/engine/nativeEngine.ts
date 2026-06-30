// frontend/src/engine/nativeEngine.ts
// UciEngine implementation backed by a native UCI engine process (Tauri only):
// the bundled Stockfish sidecar OR a user-provided external binary. Mirrors
// WorkerEngine's contract: resolves once the engine answers `uciok`, splits
// batched output into trimmed lines, and routes them to the registered listener.
import { invoke, Channel } from '@tauri-apps/api/core';
import type { UciEngine } from './engine';
import { parseOptions } from './uciOptions';

/** Which native engine to spawn: the bundled Stockfish sidecar or an external binary. */
export type EngineSpec = { kind: 'bundled' } | { kind: 'external'; path: string };

export async function loadNativeEngine(spec: EngineSpec, timeoutMs = 10_000): Promise<UciEngine> {
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

  await invoke('engine_start', { spec, onLine: channel });

  const engine: UciEngine = {
    send: (cmd: string) => { invoke('engine_send', { line: cmd }).catch(() => {}); },
    onLine: (cb: (line: string) => void) => {
      listener = cb;
      // Flush lines that arrived before the listener was registered.
      for (const line of lineBuffer) cb(line);
      lineBuffer.length = 0;
    },
    dispose: () => { invoke('engine_stop').catch(() => {}); },
  };

  // Handshake: send `uci`, resolve on `uciok`, reject if the engine never initializes.
  const optionLines: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      engine.dispose();
      reject(new Error(`native engine failed to initialize within ${timeoutMs}ms`));
    }, timeoutMs);
    engine.onLine((line: string) => {
      if (line.startsWith('option name ')) optionLines.push(line);
      else if (line === 'uciok') { clearTimeout(timer); resolve(); }
    });
    engine.send('uci');
  });
  engine.options = parseOptions(optionLines);

  // After uciok, `listener` is still the inert handshake handler until the caller
  // registers their own via onLine() — lines arriving in that window are dropped,
  // matching WorkerEngine's contract.
  return engine;
}
