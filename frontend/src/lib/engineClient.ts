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
import { AnalysisSession, type SessionCallbacks, type StartOptions } from '../engine/session';
import { Orchestrator } from '../core/orchestrator';
import type { OrchestratorEngine, SessionLike } from '../core/orchestrator';

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

function presetFor(id: string): { threads: number | null; hash: number | null } {
  if (id === 'stockfish') return { threads: 2, hash: 256 };
  if (id === 'stockfish_lite') return { threads: 1, hash: 64 };
  return { threads: null, hash: null };
}

function clampThreads(desired: number | null): number | undefined {
  if (desired === null) return undefined;
  if (!threadsAvailable()) return 1; // single-threaded wasm: never set Threads > 1
  return desired;
}

const engineController: OrchestratorEngine & {
  ensureEngine(): Promise<UciEngine>;
  dispose(): void;
} = (() => {
  let engine: UciEngine | null = null;
  let loadPromise: Promise<UciEngine> | null = null;
  let desired = { threads: null as number | null, hash: null as number | null };

  function applyIfLoaded(): void {
    if (engine) {
      configureEngine(engine, {
        threads: clampThreads(desired.threads),
        hash: desired.hash ?? undefined,
      });
    }
  }

  return {
    select(id: string): void {
      desired = presetFor(id);
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
        loadPromise = loadStockfish().then((e) => {
          engine = e;
          applyIfLoaded();
          return e;
        });
      }
      return loadPromise;
    },

    dispose(): void {
      engine?.dispose();
      engine = null;
      loadPromise = null;
    },
  };
})();

// ─── lazy session ──────────────────────────────────────────────────────────
// Defers building the real AnalysisSession until the first start() call, which
// only happens when analysis is enabled.

class LazySession implements SessionLike {
  private real: AnalysisSession | null = null;
  private pendingStart: { fen: string; opts: StartOptions } | null = null;
  private loading = false;

  constructor(
    private ctrl: typeof engineController,
    private cb: SessionCallbacks,
  ) {}

  start(fen: string, opts: StartOptions): void {
    if (this.real) {
      this.real.start(fen, opts);
      return;
    }
    this.pendingStart = { fen, opts }; // newest wins
    if (!this.loading) {
      this.loading = true;
      this.ctrl
        .ensureEngine()
        .then((engine) => {
          this.real = new AnalysisSession(engine, this.cb);
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

// ─── orchestrator ──────────────────────────────────────────────────────────
// One module-level instance. Custom sessionFactory bypasses the default cast
// path (engine as unknown as UciEngine) in the orchestrator's defaultSessionFactory.

const orch = new Orchestrator(applyFrame, {
  engine: engineController,
  sessionFactory: (_engine, cb) => new LazySession(engineController, cb),
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
