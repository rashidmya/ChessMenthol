/**
 * core/orchestrator.ts — TypeScript port of chessmenthol/server/orchestrator.py.
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
 *   3. Vision commands are accepted but INERT in Phase 1b (no-op re-emit).
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
} from './chess';
import { classifyMove, type Classification } from './classify';
import { analysisToDict, classificationToDict, lastMoveToDict } from './serialize';
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

// ─── constants ────────────────────────────────────────────────────────────────

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const CLASSIFY_MIN_DEPTH = 8;
export const DEFAULT_MOVETIME_MS = 10000; // ms; null == infinite

// ─── injection seams ──────────────────────────────────────────────────────────

/** Sink for outbound frames (state / error). */
export type SendCallback = (frame: ServerFrame) => void;

/**
 * Duck-typed engine the orchestrator drives. `select`/`configure` are OPTIONAL
 * (mirrors Python's `hasattr(self._engine, "select")`). A real engine also
 * implements the UciEngine seam (`send`/`onLine`/`dispose`) so the default
 * session factory can build an `AnalysisSession`; both are optional here so
 * unit tests can inject a minimal stub.
 */
export interface OrchestratorEngine extends Partial<UciEngine> {
  select?(id: string): void;
  configure?(opts: { threads: number | null; hash: number | null }): void;
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
  // The real engine is a full UciEngine that also exposes select/configure.
  new AnalysisSession(engine as unknown as UciEngine, callbacks);

export interface OrchestratorOptions {
  engine: OrchestratorEngine;
  sessionFactory?: SessionFactory;
  analysisEnabled?: boolean;
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
  _multipv = 3;
  _threads: number | null = null;
  _hash: number | null = null;
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

  constructor(send: SendCallback, opts: OrchestratorOptions) {
    this._send = send;
    this._engine = opts.engine;
    this._analysisEnabled = opts.analysisEnabled ?? false;
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
    // Vision commands are accepted but INERT in Phase 1b: re-emit current state,
    // never touch state, never error.
    switch (cmd.type) {
      case 'capture_now':
      case 'request_region_shot':
      case 'set_region':
      case 'clear_region':
        this._send(this._stateFrame(this._lastAnalysis));
        return;
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

  setOptions(cmd: {
    depth?: number;
    multipv?: number;
    threads?: number;
    hash?: number;
    movetime?: number | null;
  }): void {
    let depth = this._depth;
    let multipv = this._multipv;
    if (cmd.depth != null) depth = cmd.depth;
    if (cmd.multipv != null) multipv = cmd.multipv;
    const threads = cmd.threads;
    const hash = cmd.hash;
    this._session.stop(); // join the prior worker before mutating shared state
    this._depth = depth;
    this._multipv = multipv;
    if ('movetime' in cmd) {
      const mt = cmd.movetime;
      this._movetimeMs = mt === null || mt === 0 || mt === undefined ? null : mt;
    }
    if (threads != null) this._threads = threads;
    if (hash != null) this._hash = hash;
    if ((threads != null || hash != null) && this._engineStarted) {
      this._engine.configure?.({ threads: this._threads, hash: this._hash });
    }
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
      if (this._threads !== null || this._hash !== null) {
        this._engine.configure?.({ threads: this._threads, hash: this._hash });
      }
    }
    this._session.start(fenOf(this._board), {
      depth: this._depth,
      multipv: this._multipv,
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
      // ---- inert vision defaults (Phase 2) ----
      visionStatus: 'idle',
      detectedOrientation: null,
      lowConfidence: [],
      region: null,
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
