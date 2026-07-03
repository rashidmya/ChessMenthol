// app/src/lib/engineOptions.ts
// Per-engine UCI option state in localStorage: the engine's advertised SCHEMA
// (cached) and the user's OVERRIDES (only values changed from the engine default),
// both keyed by engine id. Mirrors the engineRegistry localStorage idiom.
import type { UciOption } from '../engine/uciOptions';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { parseOptions } from '../engine/uciOptions';
import { get as getEngineRecord } from './engineRegistry';

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

type SchemaListener = (id: string) => void;
const schemaListeners = new Set<SchemaListener>();

/** Subscribe to schema-cache updates. Returns an unsubscribe fn. Fires with the engine
 *  id whenever its schema is (re)cached via setSchema — lets a mounted options form
 *  refresh when the engine's schema is first captured (on initial analysis load). */
export function onSchemaChange(cb: SchemaListener): () => void {
  schemaListeners.add(cb);
  return () => { schemaListeners.delete(cb); };
}

export function setSchema(id: string, schema: UciOption[]): void {
  const all = load<UciOption[]>(SCHEMA_KEY); all[id] = schema; save(SCHEMA_KEY, all);
  for (const cb of schemaListeners) cb(id);
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

/** Ensure a schema is cached for `id`; probe via Tauri if missing. Never throws.
 *  In a plain browser there is no native engine (analysis is desktop-only), so we
 *  return []. Desktop always has engine_probe, satisfying "options available before analysis". */
export async function ensureSchema(id: string): Promise<UciOption[]> {
  const cached = getSchema(id);
  if (cached) return cached;
  const rec = getEngineRecord(id);
  if (!rec || !isTauri()) return [];
  try {
    const spec = rec.kind === 'external' && rec.path
      ? { kind: 'external', path: rec.path }
      : { kind: 'bundled' };
    const { option_lines } = await invoke<{ name: string; option_lines: string[] }>('engine_probe', { spec });
    const schema = parseOptions(option_lines);
    setSchema(id, schema);
    return schema;
  } catch {
    return [];
  }
}
