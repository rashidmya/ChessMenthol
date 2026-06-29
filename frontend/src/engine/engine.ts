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

export interface EngineManifest {
  full: { single: string; multi: string };
  lite: { single: string; multi: string };
  /** Pure-JS (asm.js) build, used on webviews that crash on the wasm engine (WebKitGTK). */
  asm?: string;
}

/** Send Threads/Hash setoptions (presets / user options). */
export function configure(engine: UciEngine, cfg: EngineConfig): void {
  if (cfg.threads != null) engine.send(`setoption name Threads value ${cfg.threads}`);
  if (cfg.hash != null) engine.send(`setoption name Hash value ${cfg.hash}`);
}

/**
 * Detect the Linux Tauri webview (WebKitGTK), which reports an AppleWebKit UA on
 * Linux with no Chrome/Chromium token. WebKitGTK 2.5x SIGSEGVs while instantiating
 * the Stockfish *wasm* module (NNUE/SIMD) — verified e2e against libwebkit2gtk-4.1
 * 2.52: the web process crashes (whole window dies) even single-threaded and even
 * with JIT/wasm/sandbox JSC flags off, while a trivial wasm and the asm.js engine
 * both run fine. So on WebKitGTK we load the pure-JS asm.js build instead of wasm
 * (see loadStockfish). Chromium (WebView2), Firefox, and Chrome carry a Chrome/Gecko
 * token; macOS WKWebView lacks the Linux token — all stay on the wasm path.
 */
function isWebKitGtk(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /\bLinux\b/.test(ua) && /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
}

/**
 * True when threaded wasm (SharedArrayBuffer) is usable in this context. False on
 * WebKitGTK, which runs the single-threaded asm.js build (no wasm threads).
 */
export function threadsAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
    && (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
    && !isWebKitGtk();
}

/**
 * Load stockfish.wasm: pick the threaded build when available, else single-threaded.
 * Resolves once the engine answers `uciok`; rejects (and tears down the worker) if
 * it does not initialize within `timeoutMs`, so a failed load surfaces an error
 * instead of hanging the UI.
 */
export async function loadStockfish(
  variant: 'full' | 'lite' = 'lite',
  base = '/engine/',
  timeoutMs = 10_000,
): Promise<UciEngine> {
  const manifest: EngineManifest = await fetch(`${base}engine-manifest.json`).then((r) => r.json());
  // WebKitGTK crashes on the Stockfish wasm engine, so prefer the pure-JS asm.js
  // build there (the only build that runs without a SIGSEGV). Every other webview
  // uses wasm: threaded when SharedArrayBuffer is usable, else single-threaded.
  let file: string;
  if (isWebKitGtk() && manifest.asm) {
    file = manifest.asm;
  } else {
    const fam = manifest[variant];
    file = threadsAvailable() ? fam.multi : fam.single;
  }
  const worker = new Worker(`${base}${file}`);
  const engine = new WorkerEngine(worker);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      engine.dispose();
      reject(new Error(`stockfish failed to initialize within ${timeoutMs}ms`));
    }, timeoutMs);
    engine.onLine((line: string) => { if (line === 'uciok') { clearTimeout(timer); resolve(); } });
    engine.send('uci');
  });
  return engine;
}
