from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, Optional, Tuple

import chess

from ..analysis.classify import Classification, classify_move
from ..engine.manager import EngineManager
from ..engine.types import AnalysisInfo
from . import serialize
from .session import AnalysisSession

if TYPE_CHECKING:
    from chessmenthol.vision.types import Region

SendCallback = Callable[[dict], None]
CLASSIFY_MIN_DEPTH = 8

# AssembledPosition.orientation strings -> frontend "white"|"black".
_ORIENTATION_MAP = {"white_bottom": "white", "black_bottom": "black"}


@dataclass
class HistoryEntry:
    move: chess.Move
    san: str
    classification: Optional[Classification] = None
    last_move: Optional[dict] = None
    pre_analysis: Optional[AnalysisInfo] = None


class Orchestrator:
    """Owns the working board + settings + analysis session; turns commands into
    state frames pushed via `send`."""

    def __init__(self, send: SendCallback, *, engine=None, session_factory=None, tracker=None):
        self._send = send
        self._engine = engine if engine is not None else EngineManager()
        self._board = chess.Board()
        self._engine_id = "stockfish"
        self._depth: Optional[int] = None
        self._multipv = 3
        self._threads: Optional[int] = None
        self._hash: Optional[int] = None
        self._engine_started = False
        self._last_analysis: Optional[AnalysisInfo] = None
        self._pending: Optional[Tuple[chess.Board, chess.Move, Optional[AnalysisInfo], int]] = None
        self._last_move: Optional[dict] = None
        self._pre_move_analysis: Optional[AnalysisInfo] = None
        self._analyzing = False
        # ---- explicit move history ----
        self._base_fen = chess.STARTING_FEN
        self._history: list[HistoryEntry] = []
        self._cursor = 0
        self._analysis_enabled = True
        self._movetime: Optional[float] = 10.0  # seconds; None == infinite
        factory = session_factory or (lambda eng, cb: AnalysisSession(eng, cb))
        self._session = factory(self._engine, self._on_update)
        self._session.on_done = self._on_search_done
        # ---- vision (on-demand capture) ----
        self._tracker = tracker
        self._vision_status = "idle"
        self._detected_orientation: Optional[str] = None
        self._low_confidence: list[str] = []
        self._region: Optional["Region"] = None

    # ---- command dispatch ----
    def handle(self, cmd: dict) -> None:
        ctype = cmd.get("type")
        # Vision commands are on-demand and synchronous; no lock, no thread.
        if ctype == "capture_now":
            self._capture_now()
            return
        if ctype == "request_region_shot":
            self._request_region_shot()
            return
        if ctype == "set_region":
            self._set_region(cmd)
            return
        if ctype == "clear_region":
            self._clear_region()
            return
        try:
            if ctype == "set_fen":
                self.set_fen(cmd["fen"])
            elif ctype == "set_turn":
                self.set_turn(bool(cmd["white"]))
            elif ctype == "make_move":
                self.make_move(cmd["uci"])
            elif ctype == "undo":
                self.undo()
            elif ctype == "navigate":
                self.navigate(int(cmd["index"]))
            elif ctype == "reset":
                self.reset()
            elif ctype == "set_analysis_enabled":
                self.set_analysis_enabled(bool(cmd["enabled"]))
            elif ctype == "play_best":
                self.play_best(cmd["uci"])
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
        # Public command entry point; the body lives in `_apply_fen` so detection
        # (`_apply_detection`) can reuse it.
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
        self._session.stop()
        self._base_fen = board.fen()
        self._history = []
        self._cursor = 0
        self._board = board
        self._reset_move_state()
        self._restart()

    def set_turn(self, white: bool) -> None:
        board = self._board.copy(stack=False)
        board.turn = chess.WHITE if white else chess.BLACK
        if not board.is_valid():
            self._error("turn change produces an invalid position")
            return
        self._session.stop()
        self._base_fen = board.fen()
        self._history = []
        self._cursor = 0
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
        self._session.stop()
        before = self._last_analysis
        board_before = self._board.copy()
        self._play_move(move, board_before, before)

    def undo(self) -> None:
        self.navigate(max(0, self._cursor - 1))

    def navigate(self, index: int) -> None:
        self._session.stop()
        index = max(0, min(len(self._history), index))
        self._cursor = index
        self._rebuild_board()
        self._last_analysis = None
        self._pending = None
        self._pre_move_analysis = (self._history[index - 1].pre_analysis if index > 0 else None)
        self._last_move = self._history[index - 1].last_move if index > 0 else None
        self._restart()

    def reset(self) -> None:
        self._session.stop()
        self._base_fen = chess.STARTING_FEN
        self._history = []
        self._cursor = 0
        self._board = chess.Board()
        self._reset_move_state()
        self._restart()

    def set_analysis_enabled(self, enabled: bool) -> None:
        self._analysis_enabled = enabled
        if enabled:
            self._restart()
        else:
            self._session.stop()
            self._analyzing = False
            self._send(self._state_frame(self._last_analysis, self._board))

    def play_best(self, uci: str) -> None:
        # Atomically pop the played move and replay the engine's best move, reusing
        # the deep analysis already computed for the played move so the replayed
        # move classifies correctly (no fresh shallow re-analysis race).
        # Safe to read _pre_move_analysis before stop(): _on_update only writes it
        # while _pending is set, and by the time the UI offers "play best" the
        # played move is already classified (_pending is None), so no write races.
        before = self._pre_move_analysis
        # Defensive no-op (re-emit current state) when there is nothing to replay:
        # no retained analysis yet, an analysis with no lines, or an empty stack.
        if before is None or before.best is None or not self._board.move_stack:
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            self._error(f"invalid move: {uci!r}")
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        board_before = self._board.copy()
        board_before.pop()  # the pre-move position the retained analysis describes
        if move not in board_before.legal_moves:
            self._error(f"illegal best move: {uci}")
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        self._session.stop()
        # Step cursor back so _play_move replaces the last entry (not appends).
        self._cursor -= 1
        self._play_move(move, board_before, before)

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
        if "movetime" in cmd:
            mt = cmd["movetime"]
            self._movetime = None if mt in (None, 0) else float(mt) / 1000.0
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
        self._session.close()
        if hasattr(self._engine, "close"):
            self._engine.close()

    # ---- vision (on-demand) ----
    def _ensure_tracker(self) -> None:
        if self._tracker is None:
            from chessmenthol.vision.tracker import Tracker

            self._tracker = Tracker()

    def _capture_now(self) -> None:
        self._ensure_tracker()
        try:
            assembled = self._tracker.detect_position()
        except Exception as exc:  # noqa: BLE001 - capture/detect can fail at runtime
            self._vision_status = "no_board"
            self._error(f"capture failed: {exc}")
            return
        self._apply_detection(assembled)

    def _request_region_shot(self) -> None:
        self._ensure_tracker()
        try:
            image = self._tracker.grab_full_desktop()
            self._send(serialize.region_shot_to_dict(image))
        except Exception as exc:  # noqa: BLE001
            self._error(f"screen capture unavailable: {exc}")

    def _set_region(self, cmd: dict) -> None:
        from chessmenthol.vision.types import Region

        try:
            region = Region(int(cmd["left"]), int(cmd["top"]),
                            int(cmd["width"]), int(cmd["height"]))
        except (KeyError, ValueError, TypeError) as exc:
            self._error(f"invalid region: {exc}")
            return
        if region.width <= 0 or region.height <= 0 or region.left < 0 or region.top < 0:
            self._error("invalid region: must be positive and on-screen")
            return
        self._ensure_tracker()
        self._tracker.set_region(region)
        self._region = region
        self._capture_now()

    def _clear_region(self) -> None:
        self._region = None
        self._vision_status = "idle"
        if self._tracker is not None:
            self._tracker.set_region(None)
        self._send(self._state_frame(self._last_analysis, self._board))

    def _apply_detection(self, assembled) -> None:
        if assembled is None or not assembled.is_legal:
            self._vision_status = "no_board"
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        self._detected_orientation = _ORIENTATION_MAP.get(assembled.orientation)
        self._low_confidence = list(assembled.low_confidence)
        self._vision_status = "low_confidence" if assembled.low_confidence else "found"
        # Compare PLACEMENT only (a screenshot can't read turn/castling/ep reliably).
        if assembled.fen.split()[0] != self._board.board_fen():
            self._apply_fen(assembled.fen)
        else:
            self._send(self._state_frame(self._last_analysis, self._board))

    # ---- internals ----
    def _rebuild_board(self) -> None:
        board = chess.Board(self._base_fen)
        for entry in self._history[: self._cursor]:
            board.push(entry.move)
        self._board = board

    def _play_move(self, move: chess.Move, board_before: chess.Board,
                   before_a: Optional[AnalysisInfo]) -> None:
        san = board_before.san(move)
        del self._history[self._cursor :]
        # Separate copy: board_before is retained in _pending and must stay pre-move.
        self._board = board_before.copy()
        self._board.push(move)
        self._history.append(HistoryEntry(move=move, san=san))
        self._cursor = len(self._history)
        self._last_analysis = None
        self._last_move = None
        self._pending = (board_before, move, before_a, self._cursor - 1)
        self._restart()

    def _reset_move_state(self) -> None:
        self._last_analysis = None
        self._pending = None
        self._last_move = None
        self._pre_move_analysis = None

    def _restart(self) -> None:
        if not self._analysis_enabled:
            self._analyzing = False
            self._send(self._state_frame(self._last_analysis, self._board))
            return
        if not self._engine_started and hasattr(self._engine, "select"):
            self._engine.select(self._engine_id)
            self._engine_started = True
            if self._threads is not None or self._hash is not None:
                self._engine.configure(threads=self._threads, hash_mb=self._hash)
        self._session.start(self._board, depth=self._depth, multipv=self._multipv,
                            time_limit=self._movetime)
        self._analyzing = True
        self._send(self._state_frame(self._last_analysis, self._board))

    def _on_update(self, analysis: AnalysisInfo, board: chess.Board) -> None:
        self._last_analysis = analysis
        if (self._pending is not None and analysis.best is not None
                and analysis.best.move is not None
                and analysis.depth >= CLASSIFY_MIN_DEPTH):
            board_before, move, before_a, ply = self._pending
            # Skip (don't crash) when the pre-move analysis has no usable best move
            # -- e.g. every PV failed to parse, leaving an empty PV.
            if (before_a is not None and before_a.best is not None
                    and before_a.best.move is not None):
                c = classify_move(board_before, move, before_a, analysis)
                lm = serialize.last_move_to_dict(c, board_before, move, before_a, analysis)
                self._last_move = lm
                # Retain the deep pre-move analysis so a later play_best can reuse
                # it instead of re-deriving best from a fresh, shallow re-analysis.
                self._pre_move_analysis = before_a
                if 0 <= ply < len(self._history):
                    self._history[ply].classification = c
                    self._history[ply].last_move = lm
                    self._history[ply].pre_analysis = before_a
            self._pending = None
        self._send(self._state_frame(analysis, board))

    def _on_search_done(self) -> None:
        # A finite search reached its limit naturally: hold the last result and
        # flip analyzing off so the UI shows a frozen (not perpetually-spinning) result.
        self._analyzing = False
        self._send(self._state_frame(self._last_analysis, self._board))

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
            "visionStatus": self._vision_status,
            "detectedOrientation": self._detected_orientation,
            "lowConfidence": self._low_confidence,
            "region": (
                {"left": self._region.left, "top": self._region.top,
                 "width": self._region.width, "height": self._region.height}
                if self._region is not None else None
            ),
            "moveList": [
                {
                    "ply": i + 1,
                    "san": e.san,
                    "uci": e.move.uci(),
                    "classification": (serialize.classification_to_dict(e.classification)
                                       if e.classification is not None else None),
                }
                for i, e in enumerate(self._history)
            ],
            "currentPly": self._cursor,
            "analysisEnabled": self._analysis_enabled,
            "movetime": None if self._movetime is None else int(self._movetime * 1000),
        }

    def _error(self, message: str) -> None:
        self._send({"type": "error", "message": message})
