import { writable } from 'svelte/store';
import { Orchestrator, type SessionLike } from '@core/core/orchestrator';
import { AnalysisSession, type SessionCallbacks, type StartOptions } from '@core/engine/session';
import type { UciEngine } from '@core/engine/engine';
import type { Command, ServerFrame, StateFrame } from '@core/lib/types';
import { createEngineController, type EngineLoader } from './engineController';

/**
 * The extension's port of engineClient.ts: the same command->frame->store surface,
 * wiring the reused Orchestrator to the WASM engine. No Tauri, no vision tracker
 * (Plan 2 adds a browser tracker), no engine registry.
 */
export function createPanelClient(load: EngineLoader) {
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
  });
  orch.handle({ type: 'navigate', index: 0 }); // seed the initial frame

  return {
    state,
    lastError,
    send(cmd: Command): void { orch.handle(cmd); },
  };
}
