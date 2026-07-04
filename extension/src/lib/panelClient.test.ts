import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { createPanelClient } from './panelClient';
import type { UciEngine } from '@core/engine/engine';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// An engine that answers `go` with one info + bestmove so a real AnalysisSession runs.
// It MUST reply asynchronously: AnalysisSession.launch() sends `go` and only THEN sets
// phase='searching', and handleLine ignores info/bestmove unless phase==='searching'.
// A synchronous reply inside send() would be dropped (phase still 'idle'); queueMicrotask
// defers the reply until after launch() returns.
function scriptedEngine(): UciEngine {
  let onLine: ((l: string) => void) | null = null;
  return {
    send(cmd: string) {
      if (cmd.startsWith('go')) {
        queueMicrotask(() => {
          onLine?.('info depth 10 multipv 1 score cp 30 pv e2e4 e7e5');
          onLine?.('bestmove e2e4');
        });
      }
    },
    onLine(cb) { onLine = cb; },
    dispose() {},
    options: [],
  };
}

describe('createPanelClient', () => {
  it('set_fen + enable analysis produces a StateFrame with best lines', async () => {
    const client = createPanelClient(async () => scriptedEngine());
    client.send({ type: 'set_fen', fen: START });
    client.send({ type: 'set_analysis_enabled', enabled: true });
    // Let the async engine load + search settle. StateFrame carries `lines` directly.
    await vi.waitFor(() => {
      const s = get(client.state);
      expect(s?.lines?.length ?? 0).toBeGreaterThan(0);
    });
  });

  it('a stop before the engine finishes loading cancels the queued search', async () => {
    let resolveLoad!: (e: UciEngine) => void;
    const loadPromise = new Promise<UciEngine>((res) => { resolveLoad = res; });
    const goSpy = vi.fn();
    const spyEngine: UciEngine = {
      send(cmd: string) { if (cmd.startsWith('go')) goSpy(); },
      onLine() {},
      dispose() {},
      options: [],
    };
    const client = createPanelClient(() => loadPromise);
    client.send({ type: 'set_fen', fen: START });
    client.send({ type: 'set_analysis_enabled', enabled: true }); // begins loading
    client.send({ type: 'stop' });                                 // stop before load resolves
    resolveLoad(spyEngine);                                        // engine finishes loading now
    await new Promise((r) => setTimeout(r, 0));                    // flush the load .then chain
    expect(goSpy).not.toHaveBeenCalled();                         // queued search was cancelled
  });

  it('surfaces engine load failure via lastError and allows a retry', async () => {
    let attempt = 0;
    const client = createPanelClient(async () => {
      attempt++;
      if (attempt === 1) throw new Error('boom');
      return scriptedEngine();
    });
    client.send({ type: 'set_fen', fen: START });
    client.send({ type: 'set_analysis_enabled', enabled: true }); // attempt 1 -> rejects
    await vi.waitFor(() => expect(get(client.lastError)).toContain('engine failed to load'));
    client.send({ type: 'set_analysis_enabled', enabled: false });
    client.send({ type: 'set_analysis_enabled', enabled: true }); // attempt 2 -> succeeds
    await vi.waitFor(() => expect(get(client.state)?.lines?.length ?? 0).toBeGreaterThan(0));
    expect(attempt).toBe(2);
  });
});
