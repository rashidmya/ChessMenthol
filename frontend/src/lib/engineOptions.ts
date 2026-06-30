// frontend/src/lib/engineOptions.ts
// Per-engine UCI option state in localStorage: the engine's advertised SCHEMA
// (cached) and the user's OVERRIDES (only values changed from the engine default),
// both keyed by engine id. Mirrors the engineRegistry localStorage idiom.
import type { UciOption } from '../engine/uciOptions';

export const SCHEMA_KEY = 'chessmenthol.engineSchema';     // { [id]: UciOption[] }
export const OVERRIDES_KEY = 'chessmenthol.engineOptions'; // { [id]: { [name]: string } }

function load<T>(key: string): Record<string, T> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, T>) : {};
  } catch {
    return {};
  }
}
function save<T>(key: string, obj: Record<string, T>): void {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch { /* ignore */ }
}

export function getSchema(id: string): UciOption[] | null {
  return load<UciOption[]>(SCHEMA_KEY)[id] ?? null;
}
export function setSchema(id: string, schema: UciOption[]): void {
  const all = load<UciOption[]>(SCHEMA_KEY); all[id] = schema; save(SCHEMA_KEY, all);
}
export function getOverrides(id: string): Record<string, string> {
  return load<Record<string, string>>(OVERRIDES_KEY)[id] ?? {};
}
export function setOption(id: string, name: string, value: string): void {
  const all = load<Record<string, string>>(OVERRIDES_KEY);
  all[id] = { ...(all[id] ?? {}), [name]: value }; save(OVERRIDES_KEY, all);
}
export function resetOption(id: string, name: string): void {
  const all = load<Record<string, string>>(OVERRIDES_KEY);
  if (all[id]) { delete all[id][name]; save(OVERRIDES_KEY, all); }
}
export function resetAll(id: string): void {
  const all = load<Record<string, string>>(OVERRIDES_KEY);
  if (all[id]) { delete all[id]; save(OVERRIDES_KEY, all); }
}

/** Engine defaults (from schema) merged with overrides — what the form shows. */
export function effectiveValues(id: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of getSchema(id) ?? []) if (o.default !== undefined) out[o.name] = o.default;
  return { ...out, ...getOverrides(id) };
}

/** Drop all stored state for one engine (called when the engine is removed). */
export function clear(id: string): void {
  const s = load<UciOption[]>(SCHEMA_KEY); if (id in s) { delete s[id]; save(SCHEMA_KEY, s); }
  const o = load<Record<string, string>>(OVERRIDES_KEY); if (id in o) { delete o[id]; save(OVERRIDES_KEY, o); }
}
