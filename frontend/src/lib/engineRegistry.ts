// frontend/src/lib/engineRegistry.ts
// Owns the user's engine list: one always-present bundled Stockfish plus any
// "bring-your-own" external UCI binaries the user has added. External records
// persist to localStorage; the bundled record is synthesized at runtime and can
// never be removed. Mirrors the viewprefs.ts localStorage pattern.

export type EngineKind = 'bundled' | 'external';

export interface EngineRecord {
  id: string;                 // 'stockfish' (bundled) | uuid (external)
  name: string;               // 'Stockfish 18' | the engine's reported `id name`
  kind: EngineKind;
  path?: string;              // external only: absolute path to the binary
}

/** The bundled Stockfish — always first, never removable. */
export const BUNDLED: EngineRecord = { id: 'stockfish', name: 'Stockfish 18', kind: 'bundled' };
export const KEY = 'chessmenthol.engines';

/** Load persisted EXTERNAL records (bundled is never persisted). */
function loadExternal(): EngineRecord[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is EngineRecord =>
        !!r &&
        typeof (r as EngineRecord).id === 'string' &&
        typeof (r as EngineRecord).name === 'string' &&
        (r as EngineRecord).kind === 'external' &&
        typeof (r as EngineRecord).path === 'string',
    );
  } catch {
    return [];
  }
}

function saveExternal(records: EngineRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records.filter((r) => r.kind === 'external')));
  } catch {
    /* ignore quota/availability errors */
  }
}

/** Full list: bundled Stockfish first, then external engines (in add order). */
export function list(): EngineRecord[] {
  return [BUNDLED, ...loadExternal()];
}

/** Resolve a record by id (bundled or external), or undefined if unknown. */
export function get(id: string): EngineRecord | undefined {
  return list().find((r) => r.id === id);
}

/** Human-readable name for an id (falls back to the id for unknown engines). */
export function engineName(id: string): string {
  return get(id)?.name ?? id;
}

/** Add an external engine; ignores bundled records and duplicate ids. */
export function add(record: EngineRecord): void {
  // Never accept a non-external record, and never let an external record claim the
  // reserved bundled id (which would shadow BUNDLED in list()).
  if (record.kind !== 'external' || record.id === BUNDLED.id) return;
  const ext = loadExternal();
  if (ext.some((r) => r.id === record.id)) return;
  saveExternal([...ext, record]);
}

/** Remove an external engine by id. The bundled engine is never removed. */
export function remove(id: string): void {
  if (id === BUNDLED.id) return;
  saveExternal(loadExternal().filter((r) => r.id !== id));
}
