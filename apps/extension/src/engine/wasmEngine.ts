import type { UciEngine } from '@chessmenthol/core/engine/engine';
import { parseOptions } from '@chessmenthol/core/engine/uciOptions';
// Explicit import rather than relying on WXT's auto-import: this module is
// plain `src/`, not an entrypoint, and `browser` must stay untouched unless
// loadWasmEngine() actually runs (tests only exercise makeWasmEngine()).
import { browser, type PublicPath } from 'wxt/browser';

/**
 * Wrap an already-constructed Stockfish Web Worker as a UciEngine. Split out
 * from loadWasmEngine() so tests can inject a fake worker (no real WASM).
 * Resolves once the engine answers `uciok`; the option lines seen during the
 * handshake become `engine.options`.
 */
export function makeWasmEngine(worker: Worker, timeoutMs = 10_000): Promise<UciEngine> {
  const listeners: ((line: string) => void)[] = [];
  const optionLines: string[] = [];
  let handshakeDone = false;

  worker.onmessage = (e: MessageEvent) => {
    const line = String((e as MessageEvent<string>).data).trim();
    if (!line) return;
    if (!handshakeDone && line.startsWith('option name ')) optionLines.push(line);
    for (const cb of listeners) cb(line);
  };

  const engine: UciEngine = {
    send: (cmd) => worker.postMessage(cmd),
    onLine: (cb) => { listeners.push(cb); },
    dispose: () => { worker.onmessage = null; worker.terminate(); },
  };

  return new Promise<UciEngine>((resolve, reject) => {
    // Dispose before rejecting so a handshake timeout doesn't leak a zombie Worker
    // (a failed loadWasmEngine() may be retried by the engine controller).
    const timer = setTimeout(() => { engine.dispose(); reject(new Error('engine handshake timed out')); }, timeoutMs);
    listeners.push((line) => {
      if (line === 'uciok' && !handshakeDone) {
        handshakeDone = true;
        clearTimeout(timer);
        engine.options = parseOptions(optionLines);
        resolve(engine);
      }
    });
    worker.postMessage('uci');
  });
}

// Stockfish 18 "lite" (small NNUE) "single"-threaded build: the Plan-1 baseline —
// no SharedArrayBuffer required, runs in Chrome and Firefox everywhere. Staged by
// copy-engine.mjs (Step 5). Leading slash: browser.runtime.getURL resolves it
// against the extension root, where WXT serves public/.
const SF_WORKER_URL = '/engine/stockfish-18-lite-single.js';

/** Construct the real Stockfish worker from the web-accessible resource. */
export function loadWasmEngine(): Promise<UciEngine> {
  // WXT's generated `PublicPath` type only covers entrypoint outputs (html/js
  // pages), not files copied into public/ by our own copy-engine.mjs script —
  // so the literal is asserted through the type rather than widened to `any`.
  const url = browser.runtime.getURL(SF_WORKER_URL as PublicPath);
  const worker = new Worker(url, { type: 'classic' });
  return makeWasmEngine(worker);
}
