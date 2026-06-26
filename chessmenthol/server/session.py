from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Optional

import chess

from ..engine.types import AnalysisInfo

logger = logging.getLogger(__name__)

UpdateCallback = Callable[[AnalysisInfo, chess.Board], None]


class AnalysisSession:
    """Runs streaming analysis on one background thread, throttled and cancellable.

    `engine` only needs a `stream_analysis(board, *, multipv, depth, time)` method
    returning an iterable of AnalysisInfo with a `.stop()` (the real EngineManager,
    or a fake in tests).
    """

    def __init__(self, engine, on_update: UpdateCallback, *,
                 throttle: float = 0.1, monotonic=time.monotonic):
        self._engine = engine
        self._on_update = on_update
        self._throttle = throttle
        self._monotonic = monotonic
        self._lock = threading.Lock()
        self._stream = None
        self._thread: Optional[threading.Thread] = None

    def start(self, board: chess.Board, *, depth=None, multipv=None, time_limit=None) -> None:
        self.stop()
        # stack=False: hand the engine just the current position. python-chess
        # otherwise replays the whole move_stack (`position ... moves ...`); a stack
        # that doesn't cleanly replay (e.g. after a turn flip) makes the engine
        # search a different position than we parse PVs against -> illegal-PV spam
        # and a crashed worker. Analysing by FEN alone is immune to that.
        board_copy = board.copy(stack=False)
        # NB: the engine API names the per-move limit `time`, not `time_limit`.
        stream = self._engine.stream_analysis(
            board_copy, multipv=multipv, depth=depth, time=time_limit)
        thread = threading.Thread(target=self._run, args=(stream, board_copy), daemon=True)
        with self._lock:
            self._stream = stream
            self._thread = thread
            # Start under the lock so a racing stop() can never observe a
            # registered-but-unstarted thread (which would skip the join and leak it).
            thread.start()

    def _run(self, stream, board) -> None:
        last_emit = 0.0
        pending: Optional[AnalysisInfo] = None
        try:
            for info in stream:
                pending = info
                now = self._monotonic()
                if now - last_emit >= self._throttle:
                    self._on_update(info, board)
                    pending = None
                    last_emit = now
            if pending is not None:
                self._on_update(pending, board)
        except Exception:
            # A worker thread must never raise; log for debuggability and exit quietly.
            logger.exception("analysis worker thread crashed")

    def join(self, timeout: Optional[float] = None) -> None:
        with self._lock:
            thread = self._thread
        if thread is not None:
            thread.join(timeout=timeout)

    def stop(self) -> None:
        with self._lock:
            stream, thread = self._stream, self._thread
            self._stream, self._thread = None, None
        if stream is not None:
            stream.stop()
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)

    def close(self) -> None:
        self.stop()
