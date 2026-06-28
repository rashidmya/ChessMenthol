// frontend/src/engine/engine.ts
// UciEngine: a minimal text-in / line-out seam over a UCI engine.
// Implementations: WorkerEngine (real wasm, later task) and FakeEngine (tests, later task).

export interface UciEngine {
  /** Send a single UCI command line (no trailing newline needed). */
  send(cmd: string): void;
  /** Register a listener for engine output lines (one line per call). */
  onLine(cb: (line: string) => void): void;
  /** Quit + release resources. Idempotent. */
  dispose(): void;
}

/** Wraps a Web Worker that speaks UCI text. */
export class WorkerEngine implements UciEngine {
  private readonly worker: Worker;
  private listener: ((line: string) => void) | null = null;
  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e: MessageEvent) => {
      const data: string = typeof e === 'string' ? e : e.data;
      // stockfish may batch multiple lines in one message
      for (const line of String(data).split('\n')) {
        const trimmed = line.trim();
        if (trimmed) this.listener?.(trimmed);
      }
    };
  }
  send(cmd: string): void { this.worker.postMessage(cmd); }
  onLine(cb: (line: string) => void): void { this.listener = cb; }
  dispose(): void { try { this.worker.postMessage('quit'); } catch { /* ignore */ } this.worker.terminate(); }
}

export interface EngineConfig { threads?: number; hash?: number; }

/** Send Threads/Hash setoptions (presets / user options). */
export function configure(engine: UciEngine, cfg: EngineConfig): void {
  if (cfg.threads != null) engine.send(`setoption name Threads value ${cfg.threads}`);
  if (cfg.hash != null) engine.send(`setoption name Hash value ${cfg.hash}`);
}

/** True when threaded wasm (SharedArrayBuffer) is usable in this context. */
export function threadsAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
    && (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

/**
 * Load stockfish.wasm: pick the threaded build when available, else single-threaded.
 * Resolves once the engine answers `uciok`.
 */
export async function loadStockfish(base = '/engine/'): Promise<UciEngine> {
  const manifest: { single: string; multi: string } =
    await fetch(`${base}engine-manifest.json`).then((r) => r.json());
  const file = threadsAvailable() ? manifest.multi : manifest.single;
  const worker = new Worker(`${base}${file}`);
  const engine = new WorkerEngine(worker);
  await new Promise<void>((resolve) => {
    const onLine = (line: string) => { if (line === 'uciok') resolve(); };
    engine.onLine(onLine);
    engine.send('uci');
  });
  return engine;
}
