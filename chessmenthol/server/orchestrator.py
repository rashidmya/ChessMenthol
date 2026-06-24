from __future__ import annotations

from typing import Callable, Optional, Tuple

import chess

from ..analysis.classify import classify_move
from ..engine.manager import EngineManager
from ..engine.types import AnalysisInfo
from . import serialize
from .session import AnalysisSession

SendCallback = Callable[[dict], None]
CLASSIFY_MIN_DEPTH = 8


class Orchestrator:
    """Owns the working board + settings + analysis session; turns commands into
    state frames pushed via `send`."""

    def __init__(self, send: SendCallback, *, engine=None, session_factory=None):
        self._send = send
        self._engine = engine if engine is not None else EngineManager()
        self._board = chess.Board()
        self._engine_id = "stockfish"
        self._depth: Optional[int] = 18
        self._multipv = 3
        self._engine_started = False
        self._last_analysis: Optional[AnalysisInfo] = None
        self._pending: Optional[Tuple[chess.Board, chess.Move, Optional[AnalysisInfo]]] = None
        self._last_move: Optional[dict] = None
        self._analyzing = False
        factory = session_factory or (lambda eng, cb: AnalysisSession(eng, cb))
        self._session = factory(self._engine, self._on_update)

    # ---- command dispatch ----
    def handle(self, cmd: dict) -> None:
        ctype = cmd.get("type")
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
        if (threads is not None or hash_mb is not None) and self._engine_started:
            self._engine.configure(threads=threads, hash_mb=hash_mb)
        self._restart()

    def stop_analysis(self) -> None:
        self._session.stop()
        self._analyzing = False
        self._send(self._state_frame(self._last_analysis, self._board))

    def close(self) -> None:
        self._session.close()
        if hasattr(self._engine, "close"):
            self._engine.close()

    # ---- internals ----
    def _reset_move_state(self) -> None:
        self._last_analysis = None
        self._pending = None
        self._last_move = None

    def _restart(self) -> None:
        if not self._engine_started and hasattr(self._engine, "select"):
            self._engine.select(self._engine_id)
            self._engine_started = True
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
                self._last_move = {
                    "uci": move.uci(),
                    "classification": serialize.classification_to_dict(c),
                }
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
        }

    def _error(self, message: str) -> None:
        self._send({"type": "error", "message": message})
