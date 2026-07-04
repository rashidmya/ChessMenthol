import type { UciEngine } from '@core/engine/engine';
import type { OrchestratorEngine } from '@core/core/orchestrator';
import { formatSetOption } from '@core/engine/uciOptions';

export type EngineLoader = () => Promise<UciEngine>;

/**
 * The OrchestratorEngine for the extension: one WASM engine, loaded lazily and
 * cached. Simpler than the desktop controller (no registry / multi-engine swap).
 */
export function createEngineController(load: EngineLoader): OrchestratorEngine & {
  // Re-declared as required (OrchestratorEngine has them optional): this
  // controller always provides concrete implementations, and intersecting
  // with a required signature here de-optionalizes them for callers.
  select(id?: string): void;
  setOption(name: string, value?: string): void;
  ensureEngine(): Promise<UciEngine>;
  currentEngine(): UciEngine | null;
  dispose(): void;
} {
  let engine: UciEngine | null = null;
  let loadPromise: Promise<UciEngine> | null = null;

  return {
    // `select` is part of OrchestratorEngine but there is only one engine here.
    select() {},
    setOption(name: string, value?: string) {
      if (!engine) return;
      engine.send(formatSetOption(name, value));
    },
    ensureEngine() {
      if (!loadPromise) {
        const p = load().then((e) => { engine = e; return e; });
        loadPromise = p;
        p.catch(() => { if (loadPromise === p) loadPromise = null; });
      }
      return loadPromise;
    },
    currentEngine() { return engine; },
    dispose() {
      engine?.dispose();
      engine = null;
      loadPromise = null;
    },
  };
}
