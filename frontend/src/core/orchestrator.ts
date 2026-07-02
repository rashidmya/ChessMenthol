/**
 * core/orchestrator.ts — Ported from the original Python chessmenthol/server/orchestrator.py (removed in the Svelte+Tauri migration).
 *
 * The committed Python is the line-by-line parity spec. This module owns the
 * working board + settings + analysis session and turns commands into state
 * frames pushed via `send`.
 *
 * Runtime-model mapping (python-chess -> our TS):
 *   - chess.Board                -> chessops `Chess` (via core/chess.ts)
 *   - board.copy(); board.push() -> playUci(pos, uci) returns a NEW position
 *                                   (never mutates; keeps a retained board_before valid)
 *   - no move stack in chessops  -> the board is rebuilt by replaying base_fen +
 *                                   history entries up to the cursor
 *
 * Key simplifications vs Python (reconciled against the parity tests):
 *   1. Movetime is MILLISECONDS throughout (Python stored seconds). The command
 *      `movetime` is ms, stored verbatim in `_movetimeMs`, passed to the session
 *      as `timeMs`, and echoed in the state frame's `movetime` field (no x1000).
 *   2. The analyzed position for serialization comes from `analysis.fen`
 *      (`_onUpdate` carries only `info`, no board).
 *   3. Vision commands drive an injected `VisionTrackerLike` facade (Phase 2).
 *      When no tracker is injected (pure-web / non-Tauri) the handlers degrade
 *      gracefully: re-emit the current state, never throw.
 *
 * All chess logic is routed through core/chess.ts; chessops is never imported here.
 */

import {
  type Chess,
  type Color,
  posFromFen,
  fenOf,
  playUci,
  sanOf,
  legalMovesUci,
  outcomeOf,
  boardFenOf,
} from './chess';
import { parseGame } from './pgn';
import { perSideClassCounts, type ClassCounts } from './report';
import { cpFromEval, winPercent, gameAccuracy, acpl } from './accuracy';
import { classifyMove, type Classification } from './classify';
import { analysisToDict, classificationToDict, lastMoveToDict, regionShotToDict } from './serialize';
import type { AssembledPosition } from '../vision/position';
import type { RgbaImage } from '../lib/capture';
import { type AnalysisInfo, type Eval, bestLine, lineMove } from '../engine/types';
import { AnalysisSession, type StartOptions, type SessionCallbacks } from '../engine/session';
import type { UciEngine } from '../engine/engine';
import type {
  Command,
  ServerFrame,
  StateFrame,
  LastMoveDto,
  EvalDto,
  LineDto,
  GameReportDto,
  PlyReportDto,
  PlayerReportDto,
} from '../lib/types';
import { setOption as storeSetOption, resetOption as storeResetOption, resetAll as storeResetAll, getOverrides } from '../lib/engineOptions';

// ─── constants ────────────────────────────────────────────────────────────────

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const CLASSIFY_MIN_DEPTH = 8;
export const DEFAULT_MOVETIME_MS = 10000; // ms; null == infinite
export const ANNOTATE_DEBOUNCE_MS = 150;

// ─── injection seams ──────────────────────────────────────────────────────────

/** Sink for outbound frames (state / error). */
export type SendCallback = (frame: ServerFrame) => void;

/**
 * Duck-typed engine the orchestrator drives. `select`/`setOption` are OPTIONAL
 * (mirrors Python's `hasattr(self._engine, "select")`). A real engine also
 * implements the UciEngine seam (`send`/`onLine`/`dispose`) so the default
 * session factory can build an `AnalysisSession`; both are optional here so
 * unit tests can inject a minimal stub.
 */
export interface OrchestratorEngine extends Partial<UciEngine> {
  select?(id: string): void;
  setOption?(name: string, value?: string): void;
}

/** What the orchestrator needs from a session (AnalysisSession satisfies this). */
export interface SessionLike {
  start(fen: string, opts: StartOptions): void;
  stop(): void;
  dispose(): void;
}

/** Builds the analysis session; substitutable so tests inject a FakeSession. */
export type SessionFactory = (
  engine: OrchestratorEngine,
  callbacks: SessionCallbacks,
) => SessionLike;

const defaultSessionFactory: SessionFactory = (engine, callbacks) =>
  // The real engine is a full UciEngine that also exposes select/setOption.
  new AnalysisSession(engine as unknown as UciEngine, callbacks);

/**
 * The subset of the vision facade the orchestrator drives (all async where the
 * capture/worker round-trip is async). Injected ONLY under Tauri (built in
 * Task iii.1: `VisionTracker` = Capturer + worker client); non-Tauri builds
 * inject nothing and the handlers degrade to a state re-emit.
 */
export interface VisionTrackerLike {
  detectPosition(): Promise<AssembledPosition | null>;
  grabFullDesktop(): Promise<RgbaImage>;
  setRegion(region: { left: number; top: number; width: number; height: number } | null): void;
  setSideOverride(white: boolean | null): void;
  setOrientationOverride(o: 'white_bottom' | 'black_bottom' | null): void;
  reset(): void;
}

export interface OrchestratorOptions {
  engine: OrchestratorEngine;
  sessionFactory?: SessionFactory;
  analysisEnabled?: boolean;
  tracker?: VisionTrackerLike;
}

/** A single played move in the explicit linear history. */
export interface HistoryEntry {
  move: string; // UCI
  san: string;
  classification?: Classification;
  lastMove?: LastMoveDto;
  preAnalysis?: AnalysisInfo;
}

/** (board_before, uci, before_analysis, ply) awaiting deep-analysis classify. */
type Pending = [Chess, string, AnalysisInfo | null, number];

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class Orchestrator {
  // ---- collaborators ----
  _send: SendCallback;
  _engine: OrchestratorEngine;
  _session: SessionLike;

  // ---- working board + settings ----
  _board: Chess = posFromFen(START_FEN);
  _engineId = 'stockfish';
  _depth: number | null = null;
  _engineStarted = false;
  _movetimeMs: number | null = DEFAULT_MOVETIME_MS; // ms; null == infinite

  // ---- analysis / classify state ----
  _lastAnalysis: AnalysisInfo | null = null;
  _pending: Pending | null = null;
  _lastMove: LastMoveDto | null = null;
  _preMoveAnalysis: AnalysisInfo | null = null;
  _analyzing = false;
  _annotating = false;
  _annotate: { boardBefore: Chess; uci: string; ply: number; latest: AnalysisInfo | null } | null = null;
  private _annotateTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- explicit move history ----
  _baseFen = START_FEN;
  _history: HistoryEntry[] = [];
  _cursor = 0;
  private _whiteName: string | undefined = undefined;
  private _blackName: string | undefined = undefined;

  // ---- gates ----
  _analysisEnabled: boolean;
  _gameOver: { result: string; reason: string } | null = null;
  _reportProgress: { done: number; total: number } | null = null;
  _reportDepth = 18;
  private _batch: {
    fens: string[];
    i: number;
    evals: (AnalysisInfo | null)[];
    latest: AnalysisInfo | null;
    priorMpv: string | null;
  } | null = null;

  // ---- vision (on-demand; tracker injected only under Tauri) ----
  _tracker: VisionTrackerLike | null;
  _visionStatus: 'idle' | 'found' | 'low_confidence' | 'no_board' = 'idle';
  _detectedOrientation: 'white' | 'black' | null = null;
  _lowConfidence: string[] = [];
  _region: { left: number; top: number; width: number; height: number } | null = null;

  constructor(send: SendCallback, opts: OrchestratorOptions) {
    this._send = send;
    this._engine = opts.engine;
    this._analysisEnabled = opts.analysisEnabled ?? false;
    this._tracker = opts.tracker ?? null;
    const factory = opts.sessionFactory ?? defaultSessionFactory;
    this._session = factory(this._engine, {
      onUpdate: this._onUpdate,
      onDone: this._onSearchDone,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // command dispatch
  // ──────────────────────────────────────────────────────────────────────────

  handle(cmd: Command): void {
    // While a whole-game batch is running the engine session is exclusively ours;
    // ignore every board/nav/settings/vision mutation so it can't preempt the shared
    // AnalysisSession and corrupt the report. Only stop/cancel may tear the batch down
    // (stopAnalysis delegates to cancelAnalysis when _batch !== null). The batch itself
    // advances via the internal _onSearchDone/_onUpdate callbacks, not via handle().
    if (this._batch !== null && cmd.type !== 'cancel_analysis' && cmd.type !== 'stop') {
      this._send(this._stateFrame(this._lastAnalysis)); // re-emit current state (rejects the action)
      return;
    }
    // Vision commands route to the real (mostly async) handlers. The async ones
    // are fire-and-forget: each method catches + emits its own error/state frame,
    // so a rejection never escapes here.
    switch (cmd.type) {
      case 'capture_now': void this._captureNow(); return;
      case 'request_region_shot': void this._requestRegionShot(); return;
      case 'set_region': this._setRegion(cmd); return;
      case 'clear_region': this._clearRegion(); return;
    }
    try {
      switch (cmd.type) {
        case 'set_fen': this.setFen(cmd.fen); break;
        case 'set_turn': this.setTurn(Boolean(cmd.white)); break;
        case 'make_move': this.makeMove(cmd.uci); break;
        case 'undo': this.undo(); break;
        case 'navigate': this.navigate(cmd.index); break;
        case 'reset': this.reset(); break;
        case 'set_analysis_enabled': this.setAnalysisEnabled(Boolean(cmd.enabled)); break;
        case 'play_best': this.playBest(cmd.uci); break;
        case 'set_engine': this.setEngine(cmd.id); break;
        case 'set_options': this.setOptions(cmd); break;
        case 'set_engine_option': this.setEngineOption(cmd.name, cmd.value); break;
        case 'reset_engine_option': this.resetEngineOption(cmd.name); break;
        case 'reset_engine_options': this.resetEngineOptions(); break;
        case 'stop': this.stopAnalysis(); break;
        case 'load_pgn': this.loadPgn(cmd.pgn); break;
        case 'analyze_game': this.analyzeGame(); break;
        case 'cancel_analysis': this.cancelAnalysis(); break;
        default: this._error(`unknown command: ${(cmd as { type: string }).type}`);
      }
    } catch (exc) {
      this._error(exc instanceof Error ? exc.message : String(exc));
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // commands
  // ──────────────────────────────────────────────────────────────────────────

  setFen(fen: string): void {
    // Public entry point; body lives in `_applyFen` so detection could reuse it.
    this._applyFen(fen);
  }

  private _applyFen(fen: string): void {
    let board: Chess;
    try {
      board = posFromFen(fen); // throws on invalid FEN OR illegal setup
    } catch (exc) {
      this._error(`invalid FEN: ${exc instanceof Error ? exc.message : String(exc)}`);
      return;
    }
    this._session.stop();
    this._cancelAnnotate();
    this._whiteName = undefined; this._blackName = undefined;
    this._baseFen = fenOf(board);
    this._history = [];
    this._cursor = 0;
    this._board = board;
    this._resetMoveState();
    this._restart();
  }

  loadPgn(pgn: string): void {
    let parsed: ReturnType<typeof parseGame>;
    try {
      parsed = parseGame(pgn);
    } catch (exc) {
      this._error(`invalid PGN: ${exc instanceof Error ? exc.message : String(exc)}`);
      return;
    }
    let board: Chess;
    try {
      board = posFromFen(parsed.baseFen);
    } catch (exc) {
      this._error(`invalid PGN start position: ${exc instanceof Error ? exc.message : String(exc)}`);
      return;
    }
    this._session.stop();
    this._cancelAnnotate();
    this._whiteName = parsed.headers.get('White') || undefined;
    this._blackName = parsed.headers.get('Black') || undefined;
    this._baseFen = fenOf(board);
    this._history = [];
    for (const m of parsed.moves) {
      // Store the app's canonical SAN (sanOf on the pre-move board) rather than
      // the raw PGN token, matching the live-play path (_playMove) so the report
      // tasks that read _history[].san see consistent notation.
      this._history.push({ move: m.uci, san: sanOf(board, m.uci) });
      board = playUci(board, m.uci);
    }
    this._cursor = this._history.length;
    this._board = board;
    this._resetMoveState();
    this._restart();
  }

  setTurn(white: boolean): void {
    // Build a position equal to `_board` but with the given side to move.
    const parts = fenOf(this._board).split(' ');
    parts[1] = white ? 'w' : 'b';
    let board: Chess;
    try {
      board = posFromFen(parts.join(' '));
    } catch {
      this._error('turn change produces an invalid position');
      return;
    }
    this._session.stop();
    // A pending before-pass shares this session; the board is about to change, so
    // tear it down. (_resetMoveState below already clears _annotating/_pending; the
    // gap _cancelAnnotate closes is the timer + the live _annotate object.)
    this._cancelAnnotate();
    this._whiteName = undefined; this._blackName = undefined;
    this._baseFen = fenOf(board);
    this._history = [];
    this._cursor = 0;
    this._board = board;
    this._resetMoveState();
    this._restart();
    // Forward the user's side override to the tracker so the next detection
    // assembles with the correct side to move (mirrors orchestrator.py set_turn).
    this._tracker?.setSideOverride(white);
  }

  makeMove(uci: string): void {
    // One combined legality check covers both invalid syntax and illegal moves.
    if (!legalMovesUci(this._board).includes(uci)) {
      this._error(`illegal move: ${uci}`);
      this._send(this._stateFrame(this._lastAnalysis)); // re-emit so the UI reverts
      return;
    }
    this._session.stop();
    this._cancelAnnotate();
    const before = this._lastAnalysis;
    const boardBefore = this._board; // playUci never mutates -> stays pre-move
    this._playMove(uci, boardBefore, before);
  }

  undo(): void {
    this.navigate(Math.max(0, this._cursor - 1));
  }

  navigate(index: number): void {
    this._session.stop();
    this._cancelAnnotate();
    index = Math.max(0, Math.min(this._history.length, index));
    this._cursor = index;
    this._rebuildBoard();
    this._lastAnalysis = null;
    this._pending = null;
    this._preMoveAnalysis = index > 0 ? this._history[index - 1].preAnalysis ?? null : null;
    this._lastMove = index > 0 ? this._history[index - 1].lastMove ?? null : null;
    // Live per-move annotation: if the move we landed on isn't classified yet and we can
    // analyze, evaluate its before/after so its badge appears. Debounced so fast scrubbing
    // doesn't thrash the engine.
    const needsAnnotate =
      index >= 1 &&
      this._analysisEnabled &&
      this._history[index - 1].classification === undefined;
    this._annotating = needsAnnotate;
    this._restart(); // analyze the current position for display (emits a frame with annotating)
    if (needsAnnotate) {
      this._annotateTimer = setTimeout(() => {
        this._annotateTimer = null;
        this._startAnnotate(this._cursor);
      }, ANNOTATE_DEBOUNCE_MS);
    }
  }

  reset(): void {
    this._session.stop();
    this._cancelAnnotate();
    this._whiteName = undefined; this._blackName = undefined;
    this._baseFen = START_FEN;
    this._history = [];
    this._cursor = 0;
    this._board = posFromFen(START_FEN);
    this._resetMoveState();
    this._restart();
  }

  setAnalysisEnabled(enabled: boolean): void {
    this._analysisEnabled = enabled;
    if (enabled) {
      this._restart();
    } else {
      // Disabling the engine silences _onUpdate, so a pending classification can
      // never resolve — clear it (else "Evaluating…" would stick true forever).
      this._session.stop();
      this._cancelAnnotate();
      this._analyzing = false;
      this._annotating = false;
      this._pending = null;
      this._send(this._stateFrame(this._lastAnalysis));
    }
  }

  playBest(uci: string): void {
    // Atomically pop the played move and replay the engine's best move, reusing
    // the deep analysis already computed for the played move so the replayed move
    // classifies correctly (no fresh shallow re-analysis race).
    const before = this._preMoveAnalysis;
    // Defensive no-op (re-emit) when there is nothing to replay: no retained
    // analysis, an analysis with no lines, or we are at the very start (cursor 0).
    // NOTE: no stop() here — the no-op must not disturb the running session.
    if (before === null || bestLine(before) === null || this._cursor === 0) {
      this._send(this._stateFrame(this._lastAnalysis));
      return;
    }
    const boardBefore = posFromFen(before.fen); // the pre-move position
    if (!legalMovesUci(boardBefore).includes(uci)) {
      this._error(`illegal best move: ${uci}`);
      this._send(this._stateFrame(this._lastAnalysis));
      return;
    }
    this._session.stop();
    this._cancelAnnotate();
    // Step the cursor back so _play_move REPLACES the last entry (not appends).
    this._cursor -= 1;
    this._playMove(uci, boardBefore, before);
  }

  setEngine(id: string): void {
    this._session.stop(); // join the prior worker before mutating shared state
    // Tear down any in-flight before-pass: _restart() relaunches the CURRENT
    // position, so a live _annotate would capture that eval as the "before" and
    // misroute the classify. _cancelAnnotate kills the timer + _annotate; these
    // commands don't call _resetMoveState, so clear _annotating (else the hint
    // sticks after a pending-timer case) and _pending (drop the in-flight played-
    // move classify — board unchanged, so it re-resolves on the next analysis).
    this._cancelAnnotate();
    this._annotating = false;
    this._pending = null;
    this._engineId = id;
    this._engineStarted = false;
    this._restart();
  }

  setOptions(cmd: { depth?: number; movetime?: number | null }): void {
    let depth = this._depth;
    if (cmd.depth != null) depth = cmd.depth;
    this._session.stop();
    this._cancelAnnotate(); // tear down in-flight before-pass (see setEngine)
    this._annotating = false;
    this._pending = null;
    this._depth = depth;
    if ('movetime' in cmd) {
      const mt = cmd.movetime;
      this._movetimeMs = mt === null || mt === 0 || mt === undefined ? null : mt;
    }
    this._restart();
  }

  setEngineOption(name: string, value?: string): void {
    this._session.stop();
    this._cancelAnnotate(); // tear down in-flight before-pass (see setEngine)
    this._annotating = false;
    this._pending = null;
    // Buttons (value === undefined) fire once and are NOT stored; valued options persist.
    if (value !== undefined) storeSetOption(this._engineId, name, value);
    if (this._engineStarted) this._engine.setOption?.(name, value);
    this._restart();
  }

  resetEngineOption(name: string): void {
    this._session.stop();
    this._cancelAnnotate(); // tear down in-flight before-pass (see setEngine)
    this._annotating = false;
    this._pending = null;
    storeResetOption(this._engineId, name);
    this._restart(); // engine default re-applies on the next engine load
  }

  resetEngineOptions(): void {
    this._session.stop();
    this._cancelAnnotate(); // tear down in-flight before-pass (see setEngine)
    this._annotating = false;
    this._pending = null;
    storeResetAll(this._engineId);
    this._restart();
  }

  stopAnalysis(): void {
    // A running batch report has its own teardown (clears _batch/_reportProgress
    // and restores MultiPV); a plain stop would freeze it mid-run.
    if (this._batch !== null) { this.cancelAnalysis(); return; }
    // Stopping the search freezes the last result; a still-pending classification
    // won't resolve until the next _restart(), so clear it now (no stuck "Evaluating…").
    this._session.stop();
    this._cancelAnnotate();
    this._analyzing = false;
    this._annotating = false;
    this._pending = null;
    this._send(this._stateFrame(this._lastAnalysis));
  }

  /** Tear down the session and (if it supports it) the engine. Mirrors Python's
   *  `close()`: `self._session.close(); if hasattr(self._engine, "close"): ...`. */
  close(): void {
    this._session.dispose();
    this._engine.dispose?.();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // vision (on-demand) — port of orchestrator.py _capture_now / _request_region_shot
  // / _set_region / _clear_region / _apply_detection. No tracker ⇒ graceful re-emit.
  // ──────────────────────────────────────────────────────────────────────────

  private async _captureNow(): Promise<void> {
    if (this._tracker === null) {
      this._send(this._stateFrame(this._lastAnalysis));
      return;
    }
    let assembled: AssembledPosition | null;
    try {
      assembled = await this._tracker.detectPosition();
    } catch (exc) {
      // capture/detect can fail at runtime (no permission, worker error, …).
      this._visionStatus = 'no_board';
      this._error(`capture failed: ${exc instanceof Error ? exc.message : String(exc)}`);
      return;
    }
    this._applyDetection(assembled);
  }

  private async _requestRegionShot(): Promise<void> {
    if (this._tracker === null) {
      this._send(this._stateFrame(this._lastAnalysis));
      return;
    }
    try {
      const image = await this._tracker.grabFullDesktop();
      this._send(await regionShotToDict(image));
    } catch (exc) {
      this._error(`screen capture unavailable: ${exc instanceof Error ? exc.message : String(exc)}`);
    }
  }

  private _setRegion(cmd: { left: number; top: number; width: number; height: number }): void {
    const left = Number(cmd.left);
    const top = Number(cmd.top);
    const width = Number(cmd.width);
    const height = Number(cmd.height);
    // Synchronous validation: emit the error frame immediately (no async hop).
    if ([left, top, width, height].some((n) => !Number.isFinite(n))) {
      this._error('invalid region');
      return;
    }
    if (width <= 0 || height <= 0 || left < 0 || top < 0) {
      this._error('invalid region: must be positive and on-screen');
      return;
    }
    const region = { left, top, width, height };
    this._region = region;
    this._tracker?.setRegion(region);
    void this._captureNow(); // trigger a capture for the new region (async)
  }

  private _clearRegion(): void {
    this._region = null;
    this._visionStatus = 'idle';
    this._tracker?.setRegion(null);
    this._send(this._stateFrame(this._lastAnalysis));
  }

  private _applyDetection(assembled: AssembledPosition | null): void {
    if (assembled === null || !assembled.isLegal) {
      this._visionStatus = 'no_board';
      this._send(this._stateFrame(this._lastAnalysis));
      return;
    }
    this._detectedOrientation = assembled.orientation === 'black_bottom' ? 'black' : 'white';
    this._lowConfidence = [...assembled.lowConfidence];
    this._visionStatus = assembled.lowConfidence.length ? 'low_confidence' : 'found';
    // Compare PLACEMENT only (a screenshot can't read turn/castling/ep reliably).
    if (assembled.fen.split(' ')[0] !== boardFenOf(this._board)) {
      this._applyFen(assembled.fen); // stops session, resets history, restarts
    } else {
      this._send(this._stateFrame(this._lastAnalysis));
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // analysis-driving internals
  // ──────────────────────────────────────────────────────────────────────────

  // Replay base_fen + history up to an ARBITRARY cursor.
  private _boardAt(cursor: number): Chess {
    return this._history.slice(0, cursor).reduce((p, e) => playUci(p, e.move), posFromFen(this._baseFen));
  }

  private _rebuildBoard(): void {
    this._board = this._boardAt(this._cursor);
  }

  private _cancelAnnotate(): void {
    if (this._annotateTimer !== null) { clearTimeout(this._annotateTimer); this._annotateTimer = null; }
    this._annotate = null;
  }

  private _startAnnotate(index: number): void {
    if (index < 1 || index > this._history.length) { this._annotating = false; return; }
    if (this._history[index - 1].classification !== undefined) { this._annotating = false; return; }
    const boardBefore = this._boardAt(index - 1);
    this._annotate = { boardBefore, uci: this._history[index - 1].move, ply: index - 1, latest: null };
    // Setting _annotate BEFORE stop() is safe: AnalysisSession suppresses all
    // callbacks while draining (session.ts: `if (phase !== 'searching') return`
    // for info; a draining bestmove never fires onDone), so the prior search's
    // stop() can't land a stale onUpdate/onDone into this before-pass.
    this._session.stop();
    this._session.start(fenOf(boardBefore), { depth: this._depth, timeMs: this._movetimeMs });
  }

  private _finishAnnotate(): void {
    const a = this._annotate;
    if (a === null) return;
    const beforeA = a.latest;
    this._annotate = null;
    const blBefore = beforeA !== null ? bestLine(beforeA) : null;
    if (beforeA === null || blBefore === null || lineMove(blBefore) === null) {
      // No usable before-eval: give up quietly and just analyze the current position.
      this._annotating = false;
      this._session.stop();
      this._restart();
      return;
    }
    if (outcomeOf(this._board) !== null) {
      // Current position is terminal: classify against a synthetic eval (no engine needed).
      this._classifyTerminal(a.boardBefore, a.uci, beforeA, a.ply);
      this._annotating = false;
      this._session.stop();
      this._send(this._stateFrame(this._lastAnalysis));
      return;
    }
    // Hand off to the existing classify path: analyze the current position; _onUpdate
    // classifies the move (and clears _annotating) once it reaches CLASSIFY_MIN_DEPTH.
    this._pending = [a.boardBefore, a.uci, beforeA, a.ply];
    this._session.stop();
    this._restart();
  }

  private _playMove(uci: string, boardBefore: Chess, beforeA: AnalysisInfo | null): void {
    const san = sanOf(boardBefore, uci);
    this._history.length = this._cursor; // truncate any forward line
    // playUci returns a fresh position; boardBefore stays pre-move for _pending.
    this._board = playUci(boardBefore, uci);
    this._history.push({ move: uci, san });
    this._cursor = this._history.length;
    this._lastAnalysis = null;
    this._lastMove = null;
    if (outcomeOf(this._board) !== null) {
      this._pending = null;
      this._annotating = false;
      this._classifyTerminal(boardBefore, uci, beforeA, this._cursor - 1);
    } else {
      this._pending = [boardBefore, uci, beforeA, this._cursor - 1];
      const blB = beforeA !== null ? bestLine(beforeA) : null;
      this._annotating = blB !== null && lineMove(blB) !== null; // only if a badge can actually resolve
    }
    this._restart();
  }

  private _classifyTerminal(
    boardBefore: Chess,
    uci: string,
    beforeA: AnalysisInfo | null,
    ply: number,
  ): void {
    if (beforeA === null) return;
    const blBefore = bestLine(beforeA);
    if (blBefore === null || lineMove(blBefore) === null) return;

    const oc = outcomeOf(this._board);
    let winner: Color | null = null;
    if (oc !== null) {
      if (oc.result === '1-0') winner = 'white';
      else if (oc.result === '0-1') winner = 'black';
      else winner = null; // '1/2-1/2'
    }
    let evalAfter: Eval;
    if (winner === null) evalAfter = { cp: 0, mate: null };
    else if (winner === 'white') evalAfter = { cp: null, mate: 1 };
    else evalAfter = { cp: null, mate: -1 };

    const synthetic: AnalysisInfo = {
      fen: fenOf(this._board),
      depth: beforeA.depth,
      lines: [{ multipv: 1, eval: evalAfter, depth: beforeA.depth, pv: [] }],
    };
    const c = classifyMove(boardBefore, uci, beforeA, synthetic);
    const lm = lastMoveToDict(c, boardBefore, uci, beforeA, synthetic);
    this._lastMove = lm;
    this._preMoveAnalysis = beforeA;
    if (ply >= 0 && ply < this._history.length) {
      this._history[ply].classification = c;
      this._history[ply].lastMove = lm;
      this._history[ply].preAnalysis = beforeA;
    }
  }

  private _resetMoveState(): void {
    this._lastAnalysis = null;
    this._pending = null;
    this._lastMove = null;
    this._preMoveAnalysis = null;
    this._annotating = false;
  }

  private _restart(): void {
    this._gameOver = outcomeOf(this._board);
    if (!this._analysisEnabled) {
      // No engine will run, so any pending classification can never resolve —
      // clear it centrally here so _playMove-while-disabled can't stick annotating.
      this._analyzing = false;
      this._annotating = false;
      this._pending = null;
      this._send(this._stateFrame(this._lastAnalysis));
      return;
    }
    if (this._gameOver !== null) {
      this._analyzing = false;
      this._lastAnalysis = null;
      this._send(this._stateFrame(null));
      return;
    }
    if (!this._engineStarted && this._engine.select) {
      this._engine.select(this._engineId);
      this._engineStarted = true;
    }
    this._session.start(fenOf(this._board), {
      depth: this._depth,
      timeMs: this._movetimeMs,
    });
    this._analyzing = true;
    this._send(this._stateFrame(this._lastAnalysis));
  }

  // Arrow fields so `this` stays bound when handed to the session as callbacks.
  _onUpdate = (info: AnalysisInfo): void => {
    if (this._batch !== null) { this._batch.latest = info; return; }
    if (this._annotate !== null) {
      this._annotate.latest = info;                       // capture the BEFORE eval
      if (info.depth >= CLASSIFY_MIN_DEPTH) this._finishAnnotate();
      return;                                             // do NOT display the before-position lines
    }
    this._lastAnalysis = info;
    const bl = bestLine(info);
    if (
      this._pending !== null &&
      bl !== null &&
      lineMove(bl) !== null &&
      info.depth >= CLASSIFY_MIN_DEPTH
    ) {
      const [boardBefore, uci, beforeA, ply] = this._pending;
      // Skip (don't crash) when the pre-move analysis has no usable best move
      // -- e.g. every PV failed to parse, leaving an empty PV.
      const blBefore = beforeA !== null ? bestLine(beforeA) : null;
      if (beforeA !== null && blBefore !== null && lineMove(blBefore) !== null) {
        // Defense in depth (mirrors _buildReport's per-ply guard): should a
        // misrouted/illegal eval ever reach here, classifyMove/lastMoveToDict can
        // throw (e.g. the wrong side's PV move is illegal on the before-board). A
        // throw inside this session line-callback would wedge analysis, so swallow
        // it and leave the move unclassified rather than rethrow.
        try {
          const c = classifyMove(boardBefore, uci, beforeA, info);
          const lm = lastMoveToDict(c, boardBefore, uci, beforeA, info);
          this._lastMove = lm;
          // Retain the deep pre-move analysis so a later play_best can reuse it.
          this._preMoveAnalysis = beforeA;
          if (ply >= 0 && ply < this._history.length) {
            this._history[ply].classification = c;
            this._history[ply].lastMove = lm;
            this._history[ply].preAnalysis = beforeA;
          }
        } catch {
          // Skip classifying this move if it throws (e.g. missing/illegal PV).
        }
      }
      // Consume the pending classification request even when skipped so it
      // won't retry forever.
      this._pending = null;
      this._annotating = false;
    }
    this._send(this._stateFrame(info));
  };

  _onSearchDone = (): void => {
    if (this._batch !== null) {
      this._batch.evals[this._batch.i] = this._batch.latest;
      this._batchAdvance();
      return;
    }
    if (this._annotate !== null) { this._finishAnnotate(); return; }
    // A finite search reached its limit: freeze the last result (analyzing off).
    this._analyzing = false;
    this._send(this._stateFrame(this._lastAnalysis));
  };

  // ──────────────────────────────────────────────────────────────────────────
  // batch game analysis
  // ──────────────────────────────────────────────────────────────────────────

  analyzeGame(): void {
    if (this._history.length === 0) { this._error('no game to analyze'); return; }
    this._session.stop();
    // A pending live-annotation before-pass shares this single session. If its
    // debounce timer fired mid-batch, _startAnnotate (which has NO _batch guard)
    // would stop() the batch and its before-FEN eval would corrupt a report slot.
    // Cancel the timer AND clear the flags: _cancelAnnotate only kills the timer +
    // nulls _annotate, so annotating (set true by navigate before the timer runs)
    // must be cleared explicitly or it leaks a stuck "Evaluating…" through the batch
    // state frames. Clear _pending too so no stale classify request survives the batch.
    this._cancelAnnotate();
    this._annotating = false;
    this._pending = null;
    const fens: string[] = [this._baseFen];
    let pos = posFromFen(this._baseFen);
    for (const e of this._history) { pos = playUci(pos, e.move); fens.push(fenOf(pos)); }
    const priorMpv = getOverrides(this._engineId)['MultiPV'] ?? null;
    this._engine.setOption?.('MultiPV', '2');
    this._batch = { fens, i: 0, evals: new Array(fens.length).fill(null), latest: null, priorMpv };
    this._reportProgress = { done: 0, total: fens.length };
    this._analyzing = true;
    this._send(this._stateFrame(this._lastAnalysis));
    this._batchStepStart();
  }

  cancelAnalysis(): void {
    if (this._batch === null) return;
    this._session.stop();
    this._engine.setOption?.('MultiPV', this._batch.priorMpv ?? '1');
    this._batch = null;
    this._reportProgress = null;
    this._analyzing = false;
    this._send(this._stateFrame(this._lastAnalysis));
  }

  private _batchStepStart(): void {
    const b = this._batch;
    if (b === null) return;
    if (b.i >= b.fens.length) { this._batchFinish(); return; }
    const fen = b.fens[b.i];
    const board = posFromFen(fen);
    const oc = outcomeOf(board);
    if (oc !== null) {
      let evalDto: Eval;
      if (oc.result === '1-0') evalDto = { cp: null, mate: 1 };
      else if (oc.result === '0-1') evalDto = { cp: null, mate: -1 };
      else evalDto = { cp: 0, mate: null };
      b.evals[b.i] = {
        fen,
        depth: this._reportDepth,
        lines: [{ multipv: 1, eval: evalDto, depth: this._reportDepth, pv: [] }],
      };
      b.latest = null;
      this._batchAdvance();
      return;
    }
    b.latest = null;
    this._session.start(fen, { depth: this._reportDepth, timeMs: null });
  }

  private _batchAdvance(): void {
    const b = this._batch;
    if (b === null) return;
    b.i += 1;
    this._reportProgress = { done: b.i, total: b.fens.length };
    this._send(this._stateFrame(this._lastAnalysis));
    this._batchStepStart();
  }

  private _batchFinish(): void {
    const b = this._batch;
    if (b === null) return;
    this._engine.setOption?.('MultiPV', b.priorMpv ?? '1');
    const report = this._buildReport(b.evals);
    this._batch = null;
    this._reportProgress = null;
    this._analyzing = false;
    this._send({ type: 'report', report });
    this._send(this._stateFrame(this._lastAnalysis));
  }

  private _buildReport(evals: (AnalysisInfo | null)[]): GameReportDto {
    const startWhite = posFromFen(this._baseFen).turn === 'white';
    const cpsPositions: number[] = evals.map((a) => (a && bestLine(a) ? cpFromEval(bestLine(a)!.eval) : 0));
    const cpsAfterMoves = cpsPositions.slice(1);
    const { white, black } = gameAccuracy(startWhite, cpsAfterMoves);

    const plies: PlyReportDto[] = [];
    let board = posFromFen(this._baseFen);
    for (let k = 0; k < this._history.length; k++) {
      const before = evals[k], after = evals[k + 1];
      const entry = this._history[k];
      let classification: ReturnType<typeof classifyMove> | null = null;
      if (before && after && bestLine(before) && lineMove(bestLine(before)!) && bestLine(after)) {
        // Per-ply guard: one pathological position must not abort the whole-game report.
        try {
          const c = classifyMove(board, entry.move, before, after);
          classification = c;
          // Populate history entries so board navigation shows per-ply classification badges.
          entry.classification = c;
          entry.lastMove = lastMoveToDict(c, board, entry.move, before, after);
          entry.preAnalysis = before;
        } catch {
          // Skip classification for this ply if it throws (e.g. missing PV).
        }
      }
      plies.push({
        ply: k + 1,
        san: entry.san,
        uci: entry.move,
        winWhite: after && bestLine(after) ? winPercent(cpFromEval(bestLine(after)!.eval)) : 50,
        cpl: classification?.cpl ?? 0,
        classification: classification ? classificationToDict(classification) : null,
      });
      board = playUci(board, entry.move);
    }

    const cc = perSideClassCounts(plies, startWhite);
    const player = (accuracyVal: number, side: 'white' | 'black', c: ClassCounts): PlayerReportDto => ({
      accuracy: Math.round(accuracyVal),
      acpl: acpl(cpsPositions, startWhite, side),
      brilliant: c.brilliant, great: c.great, best: c.best, excellent: c.excellent, good: c.good,
      book: c.book, inaccuracy: c.inaccuracy, mistake: c.mistake, blunder: c.blunder, miss: c.miss,
    });

    return {
      white: player(white, 'white', cc.white),
      black: player(black, 'black', cc.black),
      whiteName: this._whiteName,
      blackName: this._blackName,
      startWin: winPercent(cpsPositions[0]),
      plies,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // serialization
  // ──────────────────────────────────────────────────────────────────────────

  private _stateFrame(analysis: AnalysisInfo | null): StateFrame {
    // The analyzed position is derived from `analysis.fen` (no board param);
    // everything else reflects the working board.
    const adict: { depth: number; eval: EvalDto | null; lines: LineDto[] } =
      analysis !== null
        ? analysisToDict(analysis, posFromFen(analysis.fen))
        : { depth: 0, eval: null, lines: [] };
    return {
      type: 'state',
      fen: fenOf(this._board),
      sideToMove: this._board.turn,
      engineId: this._engineId,
      analyzing: this._analyzing,
      gameOver: this._gameOver,
      eval: adict.eval,
      depth: adict.depth,
      lines: adict.lines,
      lastMove: this._lastMove,
      // ---- live vision state (Phase 2) ----
      visionStatus: this._visionStatus,
      detectedOrientation: this._detectedOrientation,
      lowConfidence: this._lowConfidence,
      region: this._region,
      // ---- history ----
      moveList: this._history.map((e, i) => ({
        ply: i + 1,
        san: e.san,
        uci: e.move,
        classification: e.classification ? classificationToDict(e.classification) : null,
      })),
      currentPly: this._cursor,
      analysisEnabled: this._analysisEnabled,
      movetime: this._movetimeMs,
      reportProgress: this._reportProgress,
      annotating: this._annotating,
    };
  }

  private _error(message: string): void {
    this._send({ type: 'error', message });
  }
}
