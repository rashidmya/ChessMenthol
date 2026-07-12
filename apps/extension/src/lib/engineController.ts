import type { UciEngine } from '@chessmenthol/core/engine/engine';
import type { OrchestratorEngine } from '@chessmenthol/core/core/orchestrator';
import { formatSetOption } from '@chessmenthol/core/engine/uciOptions';
import { applyOptions } from '@chessmenthol/core/engine/engine';
import { getOverrides } from '@chessmenthol/core/lib/engineOptions';

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
  // The orchestrator calls select(engineId) before the first session.start, so we
  // know which engine's stored overrides to replay when the async load resolves.
  let engineId = 'stockfish';

  return {
    select(id?: string) { if (id) engineId = id; },
    setOption(name: string, value?: string) {
      if (!engine) return;
      engine.send(formatSetOption(name, value));
    },
    ensureEngine() {
      if (!loadPromise) {
        const p = load().then((e) => {
          engine = e;
          // Replay persisted overrides (e.g. MultiPV) the started engine never heard.
          applyOptions(e, getOverrides(engineId), e.options ?? []);
          return e;
        });
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
