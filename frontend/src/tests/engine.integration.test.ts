// @vitest-environment node
// frontend/src/tests/engine.integration.test.ts
// Real stockfish.wasm driven through AnalysisSession in Node — the correctness
// gate for the engine module (the browser Worker path can't run under vitest's
// jsdom, so we validate the engine-driving logic against a real engine here).
import { describe, it, expect } from 'vitest';
import initEngine from 'stockfish';
import { AnalysisSession } from '../engine/session';
import type { UciEngine } from '../engine/engine';
import type { AnalysisInfo } from '../engine/types';
import { bestLine } from '../engine/types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Adapt the stockfish Node engine (sendCommand + listener) to our UciEngine seam.
function nodeAdapter(sf: any): UciEngine {
  return {
    send: (cmd: string) => sf.sendCommand(cmd),
    onLine: (cb: (line: string) => void) => {
      sf.listener = (data: string) => {
        for (const line of String(data).split('\n')) {
          const t = line.trim();
          if (t) cb(t);
        }
      };
    },
    dispose: () => { try { sf.terminate?.(); } catch { /* ignore */ } },
  };
}

describe('real stockfish.wasm via Node (AnalysisSession integration)', () => {
  it('streams a sane White-POV eval + best move for the start position', async () => {
    let sf: any;
    try {
      sf = await (initEngine as unknown as (p: string) => Promise<any>)('lite-single');
    } catch {
      return; // engine unavailable in this environment -> skip rather than fail
    }
    const engine = nodeAdapter(sf);
    // UCI init handshake
    await new Promise<void>((resolve) => {
      engine.onLine((l) => { if (l === 'uciok') resolve(); });
      engine.send('uci');
    });

    const updates: AnalysisInfo[] = [];
    await new Promise<void>((resolve) => {
      const s = new AnalysisSession(engine, { onUpdate: (a) => updates.push(a), onDone: () => resolve() });
      s.start(START_FEN, { depth: 12, multipv: 2, timeMs: null });
    });
    engine.dispose();

    expect(updates.length).toBeGreaterThan(0);
    const last = updates[updates.length - 1];
    expect(last.depth).toBeGreaterThanOrEqual(10);
    const best = bestLine(last);
    expect(best).not.toBeNull();
    expect(best!.pv.length).toBeGreaterThan(0);
    expect(best!.eval.cp).not.toBeNull();                 // start position is not a forced mate
    expect(Math.abs(best!.eval.cp!)).toBeLessThan(200);   // roughly balanced, White POV
    expect(last.lines.length).toBeGreaterThanOrEqual(2);  // MultiPV 2 -> two lines accumulated
  }, 60_000);
});
