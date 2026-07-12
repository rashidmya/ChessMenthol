import { describe, it, expect } from 'vitest';
import { makeWasmEngine } from './wasmEngine';

// Minimal stand-in for the Stockfish Web Worker.
class FakeWorker {
  onmessage: ((e: { data: string }) => void) | null = null;
  posted: string[] = [];
  terminated = false;
  postMessage(cmd: string) {
    this.posted.push(cmd);
    // emulate the handshake: `uci` -> option lines + `uciok`
    if (cmd === 'uci') {
      this.emit('option name Threads type spin default 1 min 1 max 512');
      this.emit('uciok');
    }
  }
  terminate() { this.terminated = true; }
  emit(line: string) { this.onmessage?.({ data: line }); }
}

describe('makeWasmEngine', () => {
  it('resolves after uciok and captures advertised options', async () => {
    const w = new FakeWorker();
    const engine = await makeWasmEngine(w as unknown as Worker);
    expect(w.posted).toContain('uci');
    expect(engine.options?.some((o) => o.name === 'Threads')).toBe(true);
  });

  it('routes worker lines to onLine and forwards send()', async () => {
    const w = new FakeWorker();
    const engine = await makeWasmEngine(w as unknown as Worker);
    const lines: string[] = [];
    engine.onLine((l) => lines.push(l));
    engine.send('go depth 1');
    expect(w.posted).toContain('go depth 1');
    w.emit('info depth 1 score cp 12 pv e2e4');
    expect(lines).toContain('info depth 1 score cp 12 pv e2e4');
  });

  it('dispose() terminates the worker and is idempotent', async () => {
    const w = new FakeWorker();
    const engine = await makeWasmEngine(w as unknown as Worker);
    engine.dispose();
    engine.dispose();
    expect(w.terminated).toBe(true);
  });

  it('rejects and disposes the worker on a handshake timeout', async () => {
    const w = new FakeWorker();
    w.postMessage = (cmd: string) => { w.posted.push(cmd); }; // never answers `uci`
    await expect(makeWasmEngine(w as unknown as Worker, 1)).rejects.toThrow('handshake timed out');
    expect(w.terminated).toBe(true); // no zombie worker on a failed load
  });
});
