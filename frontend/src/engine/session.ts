// frontend/src/engine/session.ts
import type { UciEngine } from './engine';
import type { AnalysisInfo } from './types';
import { buildAnalysisInfo, goLimitString, parseInfoLine, type ParsedInfo, type GoLimit } from './uci';

export interface StartOptions { depth: number | null; multipv: number; timeMs: number | null; }

export interface SessionCallbacks {
  onUpdate: (info: AnalysisInfo) => void;
  onDone?: () => void;
  throttleMs?: number;
  now?: () => number;
}

type Phase = 'idle' | 'waiting_ready' | 'searching';

export class AnalysisSession {
  private readonly engine: UciEngine;
  private readonly onUpdate: (info: AnalysisInfo) => void;
  private readonly onDone?: () => void;
  private readonly throttleMs: number;
  private readonly now: () => number;

  private phase: Phase = 'idle';
  private fen = '';
  private limit: GoLimit = { depth: null, timeMs: null };
  private lines = new Map<number, ParsedInfo>();
  private pending: AnalysisInfo | null = null;
  private lastEmit = 0;
  private lastMultipv = -1;

  constructor(engine: UciEngine, cb: SessionCallbacks) {
    this.engine = engine;
    this.onUpdate = cb.onUpdate;
    this.onDone = cb.onDone;
    this.throttleMs = cb.throttleMs ?? 100;
    this.now = cb.now ?? (() => performance.now());
    this.engine.onLine((line) => this.handleLine(line));
  }

  start(fen: string, opts: StartOptions): void {
    // Leave SEARCHING *before* sending `stop`, so the stopped search's trailing
    // `bestmove` is observed in WAITING_READY and ignored (never mistaken for the
    // new search completing) — correct regardless of how soon the engine replies.
    // The isready/readyok barrier then orders that stale bestmove ahead of our
    // new position/go.
    const wasSearching = this.phase === 'searching';
    this.phase = 'waiting_ready';
    if (wasSearching) this.engine.send('stop');
    this.fen = fen;
    this.limit = { depth: opts.depth, timeMs: opts.timeMs };
    this.lines = new Map();
    this.pending = null;
    // Prime lastEmit so the very first info of a search always emits (leading edge),
    // independent of the clock's epoch.
    this.lastEmit = this.now() - this.throttleMs;
    if (opts.multipv !== this.lastMultipv) {
      this.engine.send(`setoption name MultiPV value ${opts.multipv}`);
      this.lastMultipv = opts.multipv;
    }
    this.engine.send('isready');
  }

  stop(): void {
    // Leave SEARCHING before sending `stop` so the trailing bestmove is ignored
    // and onDone is suppressed.
    const wasSearching = this.phase === 'searching';
    this.phase = 'idle';
    this.pending = null;
    if (wasSearching) this.engine.send('stop');
  }

  dispose(): void {
    this.stop();
    this.engine.dispose();
  }

  private handleLine(line: string): void {
    if (line === 'readyok') {
      if (this.phase === 'waiting_ready') {
        this.engine.send(`position fen ${this.fen}`);
        this.engine.send(goLimitString(this.limit));
        this.phase = 'searching';
      }
      return;
    }
    if (this.phase !== 'searching') return;       // ignore stale output
    if (line.startsWith('bestmove')) {
      this.phase = 'idle';
      if (this.pending) { this.onUpdate(this.pending); this.pending = null; }
      this.onDone?.();
      return;
    }
    if (line.startsWith('info')) {
      const parsed = parseInfoLine(line);
      if (!parsed) return;
      this.lines.set(parsed.multipv, parsed);
      const info = buildAnalysisInfo(this.fen, this.lines);
      const t = this.now();
      if (t - this.lastEmit >= this.throttleMs) {
        this.onUpdate(info);
        this.pending = null;
        this.lastEmit = t;
      } else {
        this.pending = info;
      }
    }
  }
}
