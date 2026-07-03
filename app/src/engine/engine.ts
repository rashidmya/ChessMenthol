// app/src/engine/engine.ts
// UciEngine: a minimal text-in / line-out seam over a UCI engine. The only
// implementation is the native engine (nativeEngine.ts), which drives one
// native UCI process over Tauri IPC.
import { formatSetOption, type UciOption } from './uciOptions';

export interface UciEngine {
  /** Send a single UCI command line (no trailing newline needed). */
  send(cmd: string): void;
  /** Register a listener for engine output lines (one line per call). */
  onLine(cb: (line: string) => void): void;
  /** Quit + release resources. Idempotent. */
  dispose(): void;
  /** Options the engine advertised during the `uci` handshake (when captured). */
  options?: UciOption[];
}

/** Send `setoption` for each value (skips buttons). `schema` gives each option's type
 *  so booleans/values format correctly; unknown names are skipped. */
export function applyOptions(
  engine: UciEngine,
  values: Record<string, string>,
  schema: UciOption[],
): void {
  const byName = new Map(schema.map((o) => [o.name, o] as const));
  for (const [name, value] of Object.entries(values)) {
    const opt = byName.get(name);
    if (!opt || opt.type === 'button') continue;
    engine.send(formatSetOption(name, value));
  }
}
