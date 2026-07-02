// app/src/tests/workerEngine.test.ts
import { describe, it, expect } from 'vitest';
import { WorkerEngine } from '../engine/engine';

// Minimal stand-in for a Web Worker (jsdom/node has no real Worker).
class FakeWorker {
  onmessage: ((e: any) => void) | null = null;
  posted: string[] = [];
  terminated = false;
  postMessage(cmd: string): void { this.posted.push(cmd); }
  terminate(): void { this.terminated = true; }
}

describe('WorkerEngine', () => {
  it('forwards send() to worker.postMessage', () => {
    const w = new FakeWorker();
    const e = new WorkerEngine(w as unknown as Worker);
    e.send('uci');
    expect(w.posted).toEqual(['uci']);
  });

  it('splits batched output into individual trimmed lines', () => {
    const w = new FakeWorker();
    const e = new WorkerEngine(w as unknown as Worker);
    const lines: string[] = [];
    e.onLine((l) => lines.push(l));
    w.onmessage!({ data: 'info depth 1 score cp 5 pv e2e4\nbestmove e2e4\n' });
    expect(lines).toEqual(['info depth 1 score cp 5 pv e2e4', 'bestmove e2e4']);
  });

  it('handles an event delivered as a bare string', () => {
    const w = new FakeWorker();
    const e = new WorkerEngine(w as unknown as Worker);
    const lines: string[] = [];
    e.onLine((l) => lines.push(l));
    w.onmessage!('readyok');
    expect(lines).toEqual(['readyok']);
  });

  it('dispose posts quit and terminates the worker', () => {
    const w = new FakeWorker();
    const e = new WorkerEngine(w as unknown as Worker);
    e.dispose();
    expect(w.posted).toContain('quit');
    expect(w.terminated).toBe(true);
  });
});
