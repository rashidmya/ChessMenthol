/**
 * lib/engineClient.ts — drop-in replacement for lib/ws.ts.
 *
 * Drives the in-browser Orchestrator directly (no WebSocket). Exports the same
 * store surface + send(cmd) API as ws.ts so UI components are untouched.
 *
 * Key behaviours:
 * - connected = writable(true) always (no socket).
 * - Stockfish is loaded lazily: only when analysis is first enabled, which
 *   triggers LazySession.start() → engineController.ensureEngine().
 * - A custom sessionFactory bypasses the orchestrator's default UciEngine cast.
 * - An initial state frame is emitted synchronously at module load via
 *   orch.handle({ type: 'navigate', index: 0 }).
 */

import { writable } from 'svelte/store';
import type { Command, ServerFrame, StateFrame, RegionShotFrame } from './types';
import { loadStockfish, configure as configureEngine, threadsAvailable } from '../engine/engine';
import type { UciEngine } from '../engine/engine';
import { loadNativeEngine } from '../engine/nativeEngine';
import { get as getEngine, type EngineRecord } from './engineRegistry';
import { isTauri } from '@tauri-apps/api/core';
import { AnalysisSession, type SessionCallbacks, type StartOptions } from '../engine/session';
import { Orchestrator } from '../core/orchestrator';
import type { OrchestratorEngine, SessionLike } from '../core/orchestrator';
import { Capturer, hasNativeCapture } from './capture';
import { VisionWorkerClient, VisionTracker } from '../vision/visionClient';

// ─── stores ────────────────────────────────────────────────────────────────

export const state = writable<StateFrame | null>(null);
export const lastError = writable<string | null>(null);
export const connected = writable(true); // no socket — always connected
export const errorSeq = writable(0);
export const regionShot = writable<RegionShotFrame | null>(null);

// ─── frame routing ─────────────────────────────────────────────────────────

export function applyFrame(frame: ServerFrame): void {
  if (frame.type === 'state') state.set(frame);
  else if (frame.type === 'region_shot') regionShot.set(frame);
  else if (frame.type === 'error') {
    lastError.set(frame.message);
    errorSeq.update((n) => n + 1);
  }
}

// ─── engine controller (lazy loader) ──────────────────────────────────────

function clampThreads(desired: number | null): number | undefined {
  if (desired === null) return undefined;
  // The native engine (Tauri) is a separate process that always supports threads; the
  // "single-threaded wasm" clamp only applies to the in-webview wasm/asm.js build.
  if (isTauri()) return desired;
  if (!threadsAvailable()) return 1; // single-threaded wasm: never set Threads > 1
  return desired;
}

export const engineController: OrchestratorEngine & {
  select(id: string): void;
  // configure is required here (it's always implemented below); OrchestratorEngine
  // declares it optional so minimal test stubs can omit it.
  configure(opts: { threads: number | null; hash: number | null }): void;
  ensureEngine(): Promise<UciEngine>;
  currentEngine(): UciEngine | null;
  dispose(): void;
} = (() => {
  let engine: UciEngine | null = null;
  let loadPromise: Promise<UciEngine> | null = null;
  let desired = { threads: null as number | null, hash: null as number | null };
  // The engine id the next load() will commit. select() updates it; a cross-id
  // switch mid-load self-heals to this value (see load()).
  let desiredId = 'stockfish';

  function applyIfLoaded(): void {
    if (engine) {
      configureEngine(engine, {
        threads: clampThreads(desired.threads),
        hash: desired.hash ?? undefined,
      });
    }
  }

  // Resolve a registry record for `id`, falling back to the bundled Stockfish for
  // an unknown/stale id (e.g. a removed external engine) so analysis keeps working.
  function recordFor(id: string): EngineRecord {
    return getEngine(id) ?? getEngine('stockfish')!;
  }

  // Build an engine for `id`. Desktop (Tauri): the native sidecar (bundled) or the
  // user's external binary. Plain browser: only the bundled wasm/asm.js engine
  // exists (external engines are Tauri-only), so any id loads via loadStockfish().
  function load(id: string): Promise<UciEngine> {
    const rec = recordFor(id);
    const loader = isTauri()
      ? loadNativeEngine(
          rec.kind === 'external' && rec.path
            ? { kind: 'external', path: rec.path }
            : { kind: 'bundled' },
        )
      // Plain browser: only the bundled wasm/asm.js engine exists, so loadStockfish() uses
      // its own default build regardless of the selected id (external engines are Tauri-only).
      : loadStockfish();
    return loader.then((e) => {
      // If the desired engine changed while this one was loading, it's the wrong
      // engine — drop it and reload the currently-desired one. The awaited promise
      // therefore self-heals to the final selection.
      if (id !== desiredId) {
        // The desired engine changed mid-load — drop this one and load the current
        // selection. Re-establish loadPromise tracking (a prior select() nulled it) so a
        // concurrent ensureEngine() can't kick off a second redundant load. Guard with
        // `!loadPromise` so we never clobber a loadPromise a newer call already set.
        e.dispose();
        const healed = load(desiredId);
        if (!loadPromise) loadPromise = healed;
        return healed;
      }
      engine = e;
      applyIfLoaded();
      return e;
    });
  }

  return {
    select(id: string): void {
      if (id !== desiredId) {
        desiredId = id;
        // A different engine is a different process/binary, so the live engine can't
        // be reused: drop it AND any in-flight load. LazySession then sees
        // currentEngine() === null and rebuilds on the newly-loaded engine.
        engine?.dispose();
        engine = null;
        loadPromise = null;
      }
      applyIfLoaded();
    },

    configure(opts: { threads: number | null; hash: number | null }): void {
      // Override desired, but only for non-null values (preserve existing entries).
      if (opts.threads !== null) desired = { ...desired, threads: opts.threads };
      if (opts.hash !== null) desired = { ...desired, hash: opts.hash };
      applyIfLoaded();
    },

    ensureEngine(): Promise<UciEngine> {
      if (!loadPromise) {
        const p = load(desiredId);
        loadPromise = p;
        // Don't cache a failed load — clear it so a later start() can retry.
        // Identity-guarded so a late rejection from a superseded load can't null
        // a newer loadPromise.
        p.catch(() => { if (loadPromise === p) loadPromise = null; });
      }
      return loadPromise;
    },

    currentEngine(): UciEngine | null {
      return engine;
    },

    dispose(): void {
      engine?.dispose();
      engine = null;
      loadPromise = null;
      desiredId = 'stockfish';
    },
  };
})();

// ─── lazy session ──────────────────────────────────────────────────────────
// Defers building the real AnalysisSession until the first start() call, which
// only happens when analysis is enabled.

class LazySession implements SessionLike {
  private real: AnalysisSession | null = null;
  private boundEngine: UciEngine | null = null;
  private pendingStart: { fen: string; opts: StartOptions } | null = null;
  private loading = false;

  constructor(
    private ctrl: typeof engineController,
    private cb: SessionCallbacks,
  ) {}

  start(fen: string, opts: StartOptions): void {
    // Fast path only while the SAME engine is still live. After an engine
    // switch the controller disposed it (currentEngine() === null), so we fall
    // through to the async reload path and rebuild `this.real` on the new binary.
    const live = this.ctrl.currentEngine();
    if (this.real && live && live === this.boundEngine) {
      this.real.start(fen, opts);
      return;
    }
    this.pendingStart = { fen, opts }; // newest wins
    if (!this.loading) {
      this.loading = true;
      this.ctrl
        .ensureEngine()
        .then((engine) => {
          // The controller already disposed any swapped-out engine; just rebind.
          this.real = new AnalysisSession(engine, this.cb);
          this.boundEngine = engine;
          this.loading = false;
          const p = this.pendingStart;
          this.pendingStart = null;
          if (p) this.real.start(p.fen, p.opts); // honor start unless stop() cleared it
        })
        .catch((err) => {
          this.loading = false;
          applyFrame({ type: 'error', message: `engine failed to load: ${err}` });
        });
    }
  }

  stop(): void {
    if (this.real) {
      this.real.stop();
    } else {
      this.pendingStart = null; // cancel a queued start while still loading
    }
  }

  dispose(): void {
    this.real?.dispose();
  }
}

// ─── vision tracker (Tauri-only) ───────────────────────────────────────────
// Returns undefined in a plain browser or jsdom (hasNativeCapture() is false),
// so no Worker is ever constructed during tests. The new URL(...) reference
// lets Vite bundle the worker for production but the Worker constructor only
// executes inside the hasNativeCapture() branch.

function makeVisionTracker(): VisionTracker | undefined {
  if (!hasNativeCapture()) return undefined; // pure-web: analysis-only
  const worker = new Worker(new URL('../vision/vision-worker.ts', import.meta.url), { type: 'module' });
  return new VisionTracker(new Capturer(), new VisionWorkerClient(worker));
}

// ─── orchestrator ──────────────────────────────────────────────────────────
// One module-level instance. Custom sessionFactory bypasses the default cast
// path (engine as unknown as UciEngine) in the orchestrator's defaultSessionFactory.

const orch = new Orchestrator(applyFrame, {
  engine: engineController,
  // `_engine` is intentionally ignored: the factory closes over `engineController`
  // directly (the same object passed as `engine`), so LazySession shares the one
  // lazy controller rather than receiving it back through the orchestrator.
  sessionFactory: (_engine, cb) => new LazySession(engineController, cb),
  tracker: makeVisionTracker(),
});

// Emit the initial start-position frame (analysis off, empty history) so the
// UI has a state to render immediately — before the user sends any command.
orch.handle({ type: 'navigate', index: 0 });

// ─── public API ────────────────────────────────────────────────────────────

/**
 * No-op: App.svelte calls this in onMount. The initial frame is already
 * emitted at module load; there's no socket to open.
 */
export function connect(): void {}

export function send(cmd: Command): void {
  orch.handle(cmd);
}
