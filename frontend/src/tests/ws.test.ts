import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { applyFrame, state, lastError, errorSeq, regionShot } from '../lib/ws';

beforeEach(() => {
  state.set(null);
  lastError.set(null);
  errorSeq.set(0);
});

describe('applyFrame', () => {
  it('stores a state frame', () => {
    const frame = {
      type: 'state', fen: 'startpos', sideToMove: 'white', engineId: 'stockfish',
      analyzing: true, eval: { cp: 30, mate: null, text: '+0.30' }, depth: 12,
      lines: [], lastMove: null,
    } as const;
    applyFrame(frame as any);
    expect(get(state)?.eval?.text).toBe('+0.30');
    expect(get(lastError)).toBeNull();
  });

  it('stores an error frame without touching state', () => {
    applyFrame({ type: 'error', message: 'bad fen' } as any);
    expect(get(lastError)).toBe('bad fen');
    expect(get(state)).toBeNull();
  });

  it('bumps errorSeq on each error frame', () => {
    const before = get(errorSeq);
    applyFrame({ type: 'error', message: 'illegal move: e1e3' } as any);
    applyFrame({ type: 'error', message: 'illegal move: e1e3' } as any);
    expect(get(errorSeq)).toBe(before + 2);
  });

  it('surfaces vision fields from a state frame', () => {
    applyFrame({
      type: 'state', fen: 'startpos', sideToMove: 'white', engineId: 'stockfish',
      analyzing: false, eval: null, depth: 0, lines: [], lastMove: null,
      visionStatus: 'found', detectedOrientation: 'black',
      lowConfidence: ['e4'], region: { left: 1, top: 2, width: 3, height: 4 },
    } as any);
    const s = get(state)!;
    expect(s.visionStatus).toBe('found');
    expect(s.detectedOrientation).toBe('black');
    expect(s.lowConfidence).toEqual(['e4']);
    expect(s.region).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it('routes a region_shot frame to the regionShot store', () => {
    applyFrame({ type: 'region_shot', jpegBase64: 'AAAA', width: 5120, height: 1440 });
    expect(get(regionShot)).toEqual({ type: 'region_shot', jpegBase64: 'AAAA', width: 5120, height: 1440 });
  });

  it('round-trips the new state-frame fields', () => {
    applyFrame({
      type: 'state', fen: 'startpos', sideToMove: 'white', engineId: 'stockfish',
      analyzing: false, eval: null, depth: 0, lines: [], lastMove: null,
      visionStatus: 'idle', detectedOrientation: null, lowConfidence: [], region: null,
      moveList: [{ ply: 1, san: 'e4', uci: 'e2e4', classification: null }],
      currentPly: 1, analysisEnabled: true, movetime: 5000,
    } as any);
    expect(get(state)!.moveList[0].san).toBe('e4');
    expect(get(state)!.currentPly).toBe(1);
    expect(get(state)!.analysisEnabled).toBe(true);
    expect(get(state)!.movetime).toBe(5000);
  });
});
