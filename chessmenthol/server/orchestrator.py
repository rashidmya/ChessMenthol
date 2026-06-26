from __future__ import annotations

import threading
from typing import Callable, Optional, Tuple

import chess

from ..analysis.classify import classify_move
from ..engine.manager import EngineManager
from ..engine.types import AnalysisInfo
from . import serialize
from .session import AnalysisSession
from .tracking import TrackingLoop

SendCallback = Callable[[dict], None]
CLASSIFY_MIN_DEPTH = 8

# Board-mutating user commands that must not be fought by the tracker. They pause
# Auto BEFORE the lock is taken (the tracking loop's _on_tracked self-acquires the
# lock, so stopping it from inside the lock would deadlock).
_PAUSE_ON_TRACKING = {"set_fen", "make_move", "undo"}

# AssembledPosition.orientation strings -> frontend "white"|"black".
_ORIENTATION_MAP = {"white_bottom": "white", "black_bottom": "black"}


class Orchestrator:
    """Owns the working board + settings + analysis session; turns commands into
    state frames pushed via `send`."""

    def __init__(self, send: SendCallback, *, engine=None, session_factory=None, tracker=None):
        self._send = send
        self._engine = engine if engine is not None else EngineManager()
        self._board = chess.Board()
        self._engine_id = "stockfish"
        self._depth: Optional[int] = 18
        self._multipv = 3
        self._threads: Optional[int] = None
        self._hash: Optional[int] = None
        self._engine_started = False
        self._last_analysis: Optional[AnalysisInfo] = None
        self._pending: Optional[Tuple[chess.Board, chess.Move, Optional[AnalysisInfo]]] = None
        self._last_move: Optional[dict] = None
        self._analyzing = False
        factory = session_factory or (lambda eng, cb: AnalysisSession(eng, cb))
        self._session = factory(self._engine, self._on_update)
        # ---- vision / tracking ----
        # `handle` holds `self._lock` for board-mutating commands; `_on_tracked`
        # (called from the tracking thread / capture_now) acquires it itself.
        # set_auto/capture_now therefore branch in `handle` BEFORE the lock.
        self._lock = threading.Lock()
        self._tracker = tracker
        self._tracking = False
        self._vision_status = "off"
        self._detected_orientation: Optional[str] = None
        self._low_confidence: list[str] = []
        self._loop = (
            TrackingLoop(self._tracker, self._on_tracked) if self._tracker is not None else None
        )

    # ---- command dispatch ----
    def handle(self, cmd: dict) -> None:
        ctype = cmd.get("type")
        # Vision commands manage the tracking loop and must NOT hold `self._lock`:
        # capture_now -> tick_once -> _on_tracked re-acquires it. Branch first.
        if ctype == "set_auto":
            self._set_auto(bool(cmd.get("on")))
            return
        if ctype == "capture_now":
            self._capture_now()
            return
        if ctype in _PAUSE_ON_TRACKING and self._tracking:
            self._set_auto(False)
        with self._lock:
            try:
                if ctype == "set_fen":
                    self.set_fen(cmd["fen"])
                elif ctype == "set_turn":
                    self.set_turn(bool(cmd["white"]))
                elif ctype == "make_move":
                    self.make_move(cmd["uci"])
                elif ctype == "undo":
                    self.undo()
                elif ctype == "set_engine":
                    self.set_engine(cmd["id"])
                elif ctype == "set_options":
                    self.set_options(cmd)
                elif ctype == "stop":
                    self.stop_analysis()
                else:
                    self._error(f"unknown command: {ctype!r}")
            except (KeyError, ValueError) as exc:
                self._error(str(exc))

    # ---- commands ----
    def set_fen(self, fen: str) -> None:
        # Thin wrapper; the actual body is lock-free so `_on_tracked` (which
        # already holds `self._lock`) can reuse it without re-acquiring.
        self._apply_fen(fen)

    def _apply_fen(self, fen: str) -> None:
        try:
            board = chess.Board(fen)
        except ValueError as exc:
            self._error(f"invalid FEN: {exc}")
            return
        if not board.is_valid():
            self._error("invalid position")
            return
        self._session.stop()  # join the prior worker before mutating shared state
        self._board = board
        self._reset_move_state()
        self._restart()

    def set_turn(self, white: bool) -> None:
        board = self._board.copy()
        board.turn = chess.WHITE if white else chess.BLACK
        if not board.is_valid():
            self._error("turn change produces an invalid position")
            return
        self._session.stop()  # join the prior worker before mutating shared state
        self._board = board
        self._reset_move_state()
        self._restart()
        if self._tracker is not None:
            self._tracker.set_side_override(chess.WHITE if white else chess.BLACK)

    def make_move(self, uci: str) -> None:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            self._error(f"invalid move: {uci!r}")
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        if move not in self._board.legal_moves:
            self._error(f"illegal move: {uci}")
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        self._session.stop()  # join the prior worker before reading/mutating state
        before = self._last_analysis
        board_before = self._board.copy()
        self._board.push(move)
        self._last_analysis = None
        self._last_move = None
        self._pending = (board_before, move, before)
        self._restart()

    def undo(self) -> None:
        self._session.stop()  # join the prior worker before mutating shared state
        if self._board.move_stack:
            self._board.pop()
        self._reset_move_state()
        self._restart()

    def set_engine(self, engine_id: str) -> None:
        self._session.stop()  # join the prior worker before mutating shared state
        self._engine_id = engine_id
        self._engine_started = False
        self._restart()

    def set_options(self, cmd: dict) -> None:
        depth = self._depth
        multipv = self._multipv
        if "depth" in cmd and cmd["depth"] is not None:
            depth = int(cmd["depth"])
        if "multipv" in cmd and cmd["multipv"] is not None:
            multipv = int(cmd["multipv"])
        threads = cmd.get("threads")
        hash_mb = cmd.get("hash")
        self._session.stop()  # join the prior worker before mutating shared state
        self._depth = depth
        self._multipv = multipv
        if threads is not None:
            self._threads = int(threads)
        if hash_mb is not None:
            self._hash = int(hash_mb)
        if (threads is not None or hash_mb is not None) and self._engine_started:
            self._engine.configure(threads=self._threads, hash_mb=self._hash)
        self._restart()

    def stop_analysis(self) -> None:
        self._session.stop()
        self._analyzing = False
        self._send(self._state_frame(self._last_analysis, self._board))

    def close(self) -> None:
        if self._loop is not None:
            self._loop.stop()
        self._session.close()
        if hasattr(self._engine, "close"):
            self._engine.close()

    # ---- vision / tracking ----
    def _ensure_loop(self) -> None:
        if self._loop is None:
            from chessmenthol.vision.tracker import Tracker

            self._tracker = Tracker()
            self._loop = TrackingLoop(self._tracker, self._on_tracked)

    def _set_auto(self, on: bool) -> None:
        self._tracking = on
        if on:
            self._ensure_loop()
            self._loop.start()
            self._vision_status = "searching"
        else:
            if self._loop is not None:
                self._loop.stop()
            self._vision_status = "off"
        self._send(self._state_frame(self._last_analysis, self._board))

    def _capture_now(self) -> None:
        self._ensure_loop()
        self._loop.tick_once()

    def _on_tracked(self, assembled) -> None:
        # Runs on the tracking thread (or directly via capture_now); acquires the
        # lock itself. Callers that already hold the lock must NOT route here.
        with self._lock:
            if assembled is None or not assembled.is_legal:
                self._vision_status = "searching"
                self._send(self._state_frame(self._last_analysis, self._board))
                return
            self._detected_orientation = _ORIENTATION_MAP.get(assembled.orientation)
            self._low_confidence = list(assembled.low_confidence)
            self._vision_status = "low_confidence" if assembled.low_confidence else "tracking"
            # Compare piece PLACEMENT only (not full FEN): a screenshot can't reliably
            # read side-to-move/castling/ep, so we re-analyze when the pieces move,
            # not when only those fields differ (avoids oscillation).
            if assembled.fen.split()[0] != self._board.board_fen():
                self._apply_fen(assembled.fen)
            else:
                self._send(self._state_frame(self._last_analysis, self._board))

    # ---- internals ----
    def _reset_move_state(self) -> None:
        self._last_analysis = None
        self._pending = None
        self._last_move = None

    def _restart(self) -> None:
        if not self._engine_started and hasattr(self._engine, "select"):
            self._engine.select(self._engine_id)
            self._engine_started = True
            if self._threads is not None or self._hash is not None:
                self._engine.configure(threads=self._threads, hash_mb=self._hash)
        self._session.start(self._board, depth=self._depth, multipv=self._multipv)
        self._analyzing = True
        self._send(self._state_frame(self._last_analysis, self._board))

    def _on_update(self, analysis: AnalysisInfo, board: chess.Board) -> None:
        self._last_analysis = analysis
        if (self._pending is not None and analysis.best is not None
                and analysis.depth >= CLASSIFY_MIN_DEPTH):
            board_before, move, before_a = self._pending
            if before_a is not None and before_a.best is not None:
                c = classify_move(board_before, move, before_a, analysis)
                self._last_move = serialize.last_move_to_dict(
                    c, board_before, move, before_a, analysis)
            self._pending = None
        self._send(self._state_frame(analysis, board))

    def _state_frame(self, analysis: Optional[AnalysisInfo], board: chess.Board) -> dict:
        adict = serialize.analysis_to_dict(analysis, board) if analysis is not None else {
            "depth": 0, "eval": None, "lines": []
        }
        return {
            "type": "state",
            "fen": self._board.fen(),
            "sideToMove": "white" if self._board.turn == chess.WHITE else "black",
            "engineId": self._engine_id,
            "analyzing": self._analyzing,
            "eval": adict["eval"],
            "depth": adict["depth"],
            "lines": adict["lines"],
            "lastMove": self._last_move,
            "tracking": self._tracking,
            "visionStatus": self._vision_status,
            "detectedOrientation": self._detected_orientation,
            "lowConfidence": self._low_confidence,
        }

    def _error(self, message: str) -> None:
        self._send({"type": "error", "message": message})
