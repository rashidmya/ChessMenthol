// frontend/src/engine/engine.ts
// UciEngine: a minimal text-in / line-out seam over a UCI engine.
// Implementations: WorkerEngine (real wasm, later task) and FakeEngine (tests, later task).

export interface UciEngine {
  /** Send a single UCI command line (no trailing newline needed). */
  send(cmd: string): void;
  /** Register a listener for engine output lines (one line per call). */
  onLine(cb: (line: string) => void): void;
  /** Quit + release resources. Idempotent. */
  dispose(): void;
}
