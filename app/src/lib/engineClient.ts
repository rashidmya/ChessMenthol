/**
 * lib/engineClient.ts — drop-in replacement for lib/ws.ts.
 *
 * Drives the in-browser Orchestrator directly (no WebSocket). Exports the same
 * store surface + send(cmd) API as ws.ts so UI components are untouched.
 *
 * Key behaviours:
 * - Stockfish is loaded lazily: only when analysis is first enabled, which
 *   triggers LazySession.start() → engineController.ensureEngine().
 * - A custom sessionFactory bypasses the orchestrator's default UciEngine cast.
 * - An initial state frame is emitted synchronously at module load via
 *   orch.handle({ type: 'navigate', index: 0 }).
 */

import { writable } from 'svelte/store';
import type { Command, ServerFrame, StateFrame, RegionShotFrame, ReportFrame, GameReportDto } from './types';
import { applyOptions } from '../engine/engine';
import type { UciEngine } from '../engine/engine';
import { loadNativeEngine } from '../engine/nativeEngine';
import { get as getEngine, type EngineRecord } from './engineRegistry';
import { getSchema, setSchema, getOverrides } from './engineOptions';
import { formatSetOption } from '../engine/uciOptions';
import { isTauri } from '@tauri-apps/api/core';
import { AnalysisSession, type SessionCallbacks, type StartOptions } from '../engine/session';
import { Orchestrator } from '../core/orchestrator';
import type { OrchestratorEngine, SessionLike } from '../core/orchestrator';
import { Capturer, hasNativeCapture } from './capture';
import { VisionWorkerClient, VisionTracker } from '../vision/visionClient';

// ─── stores ────────────────────────────────────────────────────────────────

export const state = writable<StateFrame | null>(null);
export const lastError = writable<string | null>(null);
export const errorSeq = writable(0);
export const regionShot = writable<RegionShotFrame | null>(null);
export const report = writable<GameReportDto | null>(null);
export const reportProgress = writable<{ done: number; total: number } | null>(null);

// ─── frame routing ─────────────────────────────────────────────────────────

export function applyFrame(frame: ServerFrame): void {
  if (frame.type === 'state') { state.set(frame); reportProgress.set(frame.reportProgress); }
  else if (frame.type === 'report') report.set((frame as ReportFrame).report);
  else if (frame.type === 'region_shot') regionShot.set(frame);
  else if (frame.type === 'error') {
    lastError.set(frame.message);
    errorSeq.update((n) => n + 1);
  }
}

// ─── engine controller (lazy loader) ──────────────────────────────────────

export const engineController: OrchestratorEngine & {
  select(id: string): void;
  setOption(name: string, value?: string): void;
  ensureEngine(): Promise<UciEngine>;
  currentEngine(): UciEngine | null;
  dispose(): void;
} = (() => {
  let engine: UciEngine | null = null;
  let loadPromise: Promise<UciEngine> | null = null;
  let desiredId = 'stockfish';

  function recordFor(id: string): EngineRecord {
    return getEngine(id) ?? getEngine('stockfish')!;
  }

  // Send this engine's stored overrides to the live engine (engine is idle here).
  function applyStored(): void {
    if (!engine) return;
    const schema = getSchema(desiredId) ?? engine.options ?? [];
    applyOptions(engine, getOverrides(desiredId), schema);
  }

  function load(id: string): Promise<UciEngine> {
    // Desktop-only: analysis runs on the native engine. A plain browser (the
    // renderer opened outside Tauri) has no in-process engine.
    if (!isTauri()) return Promise.reject(new Error('Analysis requires the desktop app'));
    const rec = recordFor(id);
    return loadNativeEngine(
      rec.kind === 'external' && rec.path ? { kind: 'external', path: rec.path } : { kind: 'bundled' },
    ).then((e) => {
      if (id !== desiredId) { e.dispose(); return load(desiredId); }
      engine = e;
      // Cache the freshly-advertised schema, then apply the user's overrides.
      if (e.options && e.options.length) setSchema(id, e.options);
      applyStored();
      return e;
    });
  }

  return {
    select(id: string): void {
      if (id !== desiredId) {
        desiredId = id;
        engine?.dispose();
        engine = null;
        loadPromise = null;
      }
    },

    // Push a single option change to the live engine (engine is idle: the orchestrator
    // stops the search before calling this and restarts after). No-op if not loaded.
    // `value === undefined` is a button press → `setoption name X` (no value).
    setOption(name: string, value?: string): void {
      if (!engine) return;
      engine.send(formatSetOption(name, value));
    },

    ensureEngine(): Promise<UciEngine> {
      if (!loadPromise) {
        const p = load(desiredId);
        loadPromise = p;
        p.catch(() => { if (loadPromise === p) loadPromise = null; });
      }
      return loadPromise;
    },

    currentEngine(): UciEngine | null { return engine; },

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
