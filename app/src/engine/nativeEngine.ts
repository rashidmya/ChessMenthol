// app/src/engine/nativeEngine.ts
// UciEngine implementations backed by a native UCI engine, dispatched by platform:
//  - Desktop (Tauri): the bundled Stockfish sidecar OR a user-provided external
//    binary, over the engine_start/engine_send/engine_stop commands (Channel stream).
//  - Mobile (Android/iOS): the Kotlin `engine` plugin, which spawns a bundled
//    Stockfish native library and streams its stdout as `line` plugin events.
// Both honor the UciEngine contract: resolve once the engine answers `uciok`, split
// batched output into trimmed lines, and route them to the registered listener.
import { invoke, Channel, addPluginListener } from '@tauri-apps/api/core';
import type { UciEngine } from './engine';
import { parseOptions } from './uciOptions';
import { isMobile } from '../lib/platform';

/** Which native engine to spawn: the bundled Stockfish sidecar or an external binary. */
export type EngineSpec = { kind: 'bundled' } | { kind: 'external'; path: string };

/** Shared UCI handshake: send `uci`, resolve on `uciok`, capture advertised options.
 *  Disposes + rejects if the engine never initializes within `timeoutMs`. */
async function handshake(engine: UciEngine, timeoutMs: number): Promise<void> {
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
}

/** A line sink that splits/trims engine output and buffers until onLine() registers.
 *  Shared by both transports (Channel chunks on desktop, plugin events on mobile). */
function lineSink() {
  let listener: ((line: string) => void) | null = null;
  const buffer: string[] = [];
  return {
    /** Feed a raw (possibly multi-line) chunk; trims and drops blank lines. */
    push(chunk: string): void {
      for (const raw of String(chunk).split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (listener) listener(line);
        else buffer.push(line);
      }
    },
    /** Register the consumer; flushes anything buffered before registration. */
    register(cb: (line: string) => void): void {
      listener = cb;
      for (const line of buffer) cb(line);
      buffer.length = 0;
    },
  };
}

/** Desktop: UciEngine backed by a native process (engine_start/send/stop, Channel stream). */
export async function loadNativeEngine(spec: EngineSpec, timeoutMs = 10_000): Promise<UciEngine> {
  const sink = lineSink();
  const channel = new Channel<string>();
  channel.onmessage = (chunk: string) => sink.push(chunk);

  await invoke('engine_start', { spec, onLine: channel });

  const engine: UciEngine = {
    send: (cmd: string) => { invoke('engine_send', { line: cmd }).catch(() => {}); },
    onLine: (cb) => sink.register(cb),
    dispose: () => { invoke('engine_stop').catch(() => {}); },
  };

  await handshake(engine, timeoutMs);
  return engine;
}

/** Mobile: UciEngine backed by the Kotlin `engine` plugin (spec is always bundled). */
export async function loadAndroidEngine(_spec: EngineSpec, timeoutMs = 10_000): Promise<UciEngine> {
  const sink = lineSink();
  const sub = await addPluginListener('engine', 'line', (p: { line: string }) => sink.push(p.line));

  await invoke('plugin:engine|start');

  const engine: UciEngine = {
    send: (cmd: string) => { invoke('plugin:engine|send', { line: cmd }).catch(() => {}); },
    onLine: (cb) => sink.register(cb),
    dispose: () => {
      invoke('plugin:engine|stop').catch(() => {});
      sub.unregister().catch(() => {});
    },
  };

  await handshake(engine, timeoutMs);
  return engine;
}

/** Platform dispatcher: mobile -> Kotlin engine plugin; desktop -> native sidecar process. */
export function loadEngine(spec: EngineSpec, timeoutMs = 10_000): Promise<UciEngine> {
  return isMobile() ? loadAndroidEngine(spec, timeoutMs) : loadNativeEngine(spec, timeoutMs);
}
