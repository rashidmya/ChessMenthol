import { writable } from 'svelte/store';
import { Orchestrator, type SessionLike, type VisionTrackerLike } from '@core/core/orchestrator';
import { AnalysisSession, type SessionCallbacks, type StartOptions } from '@core/engine/session';
import type { UciEngine } from '@core/engine/engine';
import type { Command, ServerFrame, StateFrame } from '@core/lib/types';
import { createEngineController, type EngineLoader } from './engineController';
import type { PositionMessage } from './messages';

/** Feed an incoming board position into the orchestrator: load it, then analyze. */
export function applyPosition(send: (cmd: Command) => void, m: PositionMessage): void {
  send({ type: 'set_fen', fen: m.fen });
  send({ type: 'set_analysis_enabled', enabled: true });
}

/**
 * The extension's port of engineClient.ts: the same command->frame->store surface,
 * wiring the reused Orchestrator to the WASM engine. No Tauri, no engine registry.
 * `tracker` is optional (Plan 1 callers omit it); Plan 2 passes a `TabTracker`
 * (see vision/visionTracker.ts) to drive capture-and-detect vision commands.
 */
export function createPanelClient(load: EngineLoader, tracker?: VisionTrackerLike) {
  const state = writable<StateFrame | null>(null);
  const lastError = writable<string | null>(null);

  // Plan 1 surfaces only state + errors. `report`/`region_shot` frames (and the
  // analyze_game / region commands that produce them) are intentionally ignored
  // until the vision/report UI lands in a later plan.
  function applyFrame(frame: ServerFrame): void {
    if (frame.type === 'state') state.set(frame);
    else if (frame.type === 'error') lastError.set(frame.message);
  }

  const engineController = createEngineController(load);

  // LazySession: build the real AnalysisSession on the first start(), rebinding
  // if the engine is (re)loaded. Ported from engineClient.ts's LazySession.
  class LazySession implements SessionLike {
    private real: AnalysisSession | null = null;
    private bound: UciEngine | null = null;
    private pending: { fen: string; opts: StartOptions } | null = null;
    private loading = false;
    constructor(private cb: SessionCallbacks) {}
    start(fen: string, opts: StartOptions): void {
      const live = engineController.currentEngine();
      if (this.real && live && live === this.bound) { this.real.start(fen, opts); return; }
      this.pending = { fen, opts };
      if (!this.loading) {
        this.loading = true;
        engineController.ensureEngine().then((engine) => {
          this.real = new AnalysisSession(engine, this.cb);
          this.bound = engine;
          this.loading = false;
          const p = this.pending; this.pending = null;
          if (p) this.real.start(p.fen, p.opts);
        }).catch((err) => {
          this.loading = false;
          applyFrame({ type: 'error', message: `engine failed to load: ${err}` });
        });
      }
    }
    stop(): void { if (this.real) this.real.stop(); else this.pending = null; }
    dispose(): void { this.real?.dispose(); }
  }

  const orch = new Orchestrator(applyFrame, {
    engine: engineController,
    // `_engine` is ignored: LazySession closes over `engineController` directly
    // (the same object passed as `engine`), mirroring the desktop original.
    sessionFactory: (_engine, cb) => new LazySession(cb),
    tracker,
  });
  orch.handle({ type: 'navigate', index: 0 }); // seed the initial frame

  return {
    state,
    lastError,
    send(cmd: Command): void { orch.handle(cmd); },
  };
}
