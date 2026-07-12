// app/src/lib/engineSchema.ts
// The Tauri-only half of engine options: probe a native engine for its UCI option schema.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { parseOptions } from '@chessmenthol/core/engine/uciOptions';
import { get as getEngineRecord } from '@chessmenthol/core/lib/engineRegistry';
import { getSchema, setSchema } from '@chessmenthol/core/lib/engineOptions';
import type { UciOption } from '@chessmenthol/core/engine/uciOptions';

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
