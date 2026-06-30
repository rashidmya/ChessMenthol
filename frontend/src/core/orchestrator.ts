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
} from '../lib/types';
import { setOption as storeSetOption, resetOption as storeResetOption, resetAll as storeResetAll } from '../lib/engineOptions';

// ─── constants ────────────────────────────────────────────────────────────────

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const CLASSIFY_MIN_DEPTH = 8;
export const DEFAULT_MOVETIME_MS = 10000; // ms; null == infinite

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

  // ---- explicit move history ----
  _baseFen = START_FEN;
  _history: HistoryEntry[] = [];
  _cursor = 0;

  // ---- gates ----
  _analysisEnabled: boolean;
  _gameOver: { result: string; reason: string } | null = null;

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
    this._baseFen = fenOf(board);
    this._history = [];
    this._cursor = 0;
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
    const before = this._lastAnalysis;
    const boardBefore = this._board; // playUci never mutates -> stays pre-move
    this._playMove(uci, boardBefore, before);
  }

  undo(): void {
    this.navigate(Math.max(0, this._cursor - 1));
  }

  navigate(index: number): void {
    this._session.stop();
    index = Math.max(0, Math.min(this._history.length, index));
    this._cursor = index;
    this._rebuildBoard();
    this._lastAnalysis = null;
    this._pending = null;
    this._preMoveAnalysis = index > 0 ? this._history[index - 1].preAnalysis ?? null : null;
    this._lastMove = index > 0 ? this._history[index - 1].lastMove ?? null : null;
    this._restart();
  }

  reset(): void {
    this._session.stop();
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
      this._session.stop();
      this._analyzing = false;
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
    // Step the cursor back so _play_move REPLACES the last entry (not appends).
    this._cursor -= 1;
    this._playMove(uci, boardBefore, before);
  }

  setEngine(id: string): void {
    this._session.stop(); // join the prior worker before mutating shared state
    this._engineId = id;
    this._engineStarted = false;
    this._restart();
  }

  setOptions(cmd: { depth?: number; movetime?: number | null }): void {
    let depth = this._depth;
    if (cmd.depth != null) depth = cmd.depth;
    this._session.stop();
    this._depth = depth;
    if ('movetime' in cmd) {
      const mt = cmd.movetime;
      this._movetimeMs = mt === null || mt === 0 || mt === undefined ? null : mt;
    }
    this._restart();
  }

  setEngineOption(name: string, value?: string): void {
    this._session.stop();
    // Buttons (value === undefined) fire once and are NOT stored; valued options persist.
    if (value !== undefined) storeSetOption(this._engineId, name, value);
    if (this._engineStarted) this._engine.setOption?.(name, value);
    this._restart();
  }

  resetEngineOption(name: string): void {
    this._session.stop();
    storeResetOption(this._engineId, name);
    this._restart(); // engine default re-applies on the next engine load
  }

  resetEngineOptions(): void {
    this._session.stop();
    storeResetAll(this._engineId);
    this._restart();
  }

  stopAnalysis(): void {
    this._session.stop();
    this._analyzing = false;
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

  private _rebuildBoard(): void {
    this._board = this._history
      .slice(0, this._cursor)
      .reduce((p, e) => playUci(p, e.move), posFromFen(this._baseFen));
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
      this._classifyTerminal(boardBefore, uci, beforeA, this._cursor - 1);
    } else {
      this._pending = [boardBefore, uci, beforeA, this._cursor - 1];
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
  }

  private _restart(): void {
    this._gameOver = outcomeOf(this._board);
    if (!this._analysisEnabled) {
      this._analyzing = false;
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
      }
      // Consume the pending classification request even when skipped so it
      // won't retry forever.
      this._pending = null;
    }
    this._send(this._stateFrame(info));
  };

  _onSearchDone = (): void => {
    // A finite search reached its limit: freeze the last result (analyzing off).
    this._analyzing = false;
    this._send(this._stateFrame(this._lastAnalysis));
  };

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
    };
  }

  private _error(message: string): void {
    this._send({ type: 'error', message });
  }
}
