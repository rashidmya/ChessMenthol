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

// 'draining' = we sent `stop` and are waiting for the stopped search's trailing
// `bestmove` before launching the next search (or going idle). We synchronize on
// `bestmove`, NOT on `readyok`: a real UCI engine answers `isready` immediately —
// even mid-search — so `readyok` arrives BEFORE the stopped search's `bestmove`
// (verified against stockfish.wasm). Draining is the order-independent way to
// supersede a search, matching how python-chess waits for the stopped bestmove.
type Phase = 'idle' | 'searching' | 'draining';

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
  private nextStart: { fen: string; opts: StartOptions } | null = null;

  constructor(engine: UciEngine, cb: SessionCallbacks) {
    this.engine = engine;
    this.onUpdate = cb.onUpdate;
    this.onDone = cb.onDone;
    this.throttleMs = cb.throttleMs ?? 100;
    this.now = cb.now ?? (() => performance.now());
    this.engine.onLine((line) => this.handleLine(line));
  }

  start(fen: string, opts: StartOptions): void {
    if (this.phase === 'searching') {
      // Stop the running search and wait for its bestmove before launching the new
      // one. Set state BEFORE sending `stop` so a synchronously-delivered bestmove
      // is handled as a drain, not as the running search completing.
      this.nextStart = { fen, opts };
      this.pending = null;
      this.phase = 'draining';
      this.engine.send('stop');
      return;
    }
    if (this.phase === 'draining') {
      // Already draining a prior stop; queue the latest request (newest wins).
      this.nextStart = { fen, opts };
      return;
    }
    this.launch(fen, opts); // idle
  }

  stop(): void {
    if (this.phase === 'searching') {
      this.nextStart = null;
      this.pending = null;
      this.phase = 'draining';
      this.engine.send('stop');
    } else if (this.phase === 'draining') {
      this.nextStart = null; // cancel any queued start; stay draining until bestmove
    }
  }

  dispose(): void {
    this.stop();
    this.engine.dispose();
  }

  private launch(fen: string, opts: StartOptions): void {
    this.fen = fen;
    this.limit = { depth: opts.depth, timeMs: opts.timeMs };
    this.lines = new Map();
    this.pending = null;
    this.nextStart = null;
    // Prime lastEmit so the first info of a search always emits (leading edge),
    // independent of the clock's epoch.
    this.lastEmit = this.now() - this.throttleMs;
    if (opts.multipv !== this.lastMultipv) {
      this.engine.send(`setoption name MultiPV value ${opts.multipv}`);
      this.lastMultipv = opts.multipv;
    }
    this.engine.send(`position fen ${fen}`);
    this.engine.send(goLimitString(this.limit));
    this.phase = 'searching';
  }

  private handleLine(line: string): void {
    if (line.startsWith('bestmove')) {
      if (this.phase === 'searching') {
        this.phase = 'idle';
        if (this.pending) { this.onUpdate(this.pending); this.pending = null; }
        this.onDone?.();
      } else if (this.phase === 'draining') {
        // The stopped search's trailing bestmove. Launch the queued search, if any;
        // never fires onDone (this search was superseded/cancelled, not completed).
        const next = this.nextStart;
        this.nextStart = null;
        if (next) this.launch(next.fen, next.opts);
        else this.phase = 'idle';
      }
      return;
    }
    if (this.phase !== 'searching') return; // ignore info/other lines while idle/draining
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
