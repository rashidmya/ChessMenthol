from __future__ import annotations

from typing import Dict, Optional

import chess
import chess.engine

from .spec import EngineSpec, default_registry
from .types import AnalysisInfo


class EngineManager:
    """Owns a single UCI engine subprocess. One engine is active at a time."""

    def __init__(self, registry: Optional[Dict[str, EngineSpec]] = None):
        self._registry = registry if registry is not None else default_registry()
        self._engine: Optional[chess.engine.SimpleEngine] = None
        self._active_id: Optional[str] = None
        self._multipv = 3

    @property
    def active_id(self) -> Optional[str]:
        return self._active_id

    def select(self, engine_id: str) -> None:
        if engine_id not in self._registry:
            raise KeyError(f"Unknown engine: {engine_id}")
        if self._active_id == engine_id and self._engine is not None:
            return
        self._start(engine_id)

    def _start(self, engine_id: str) -> None:
        self.close()
        spec = self._registry[engine_id]
        engine = chess.engine.SimpleEngine.popen_uci(str(spec.binary))
        try:
            if spec.default_options:
                engine.configure(dict(spec.default_options))
        except Exception:
            try:
                engine.quit()
            except Exception:
                pass
            raise
        self._engine = engine
        self._active_id = engine_id

    def configure(self, *, threads: Optional[int] = None,
                  hash_mb: Optional[int] = None,
                  multipv: Optional[int] = None) -> None:
        if multipv is not None:
            self._multipv = multipv
        opts: Dict[str, object] = {}
        if threads is not None:
            opts["Threads"] = threads
        if hash_mb is not None:
            opts["Hash"] = hash_mb
        if opts:
            self._require().configure(opts)

    def analyze(self, board: chess.Board, *,
                depth: Optional[int] = None,
                time: Optional[float] = None,
                multipv: Optional[int] = None) -> AnalysisInfo:
        mpv = multipv if multipv is not None else self._multipv
        if depth is None and time is None:
            depth = 18
        limit = chess.engine.Limit(depth=depth, time=time)
        try:
            infos = self._require().analyse(board, limit, multipv=mpv)
        except chess.engine.EngineError:
            self._restart()
            infos = self._require().analyse(board, limit, multipv=mpv)
        if isinstance(infos, dict):
            infos = [infos]
        return AnalysisInfo.from_engine(board.fen(), infos)

    def stream_analysis(self, board: chess.Board, *,
                        depth: Optional[int] = None,
                        time: Optional[float] = None,
                        multipv: Optional[int] = None) -> "AnalysisStream":
        mpv = multipv if multipv is not None else self._multipv
        if depth is None and time is None:
            depth = 18
        limit = chess.engine.Limit(depth=depth, time=time)
        result = self._require().analysis(board, limit, multipv=mpv)
        return AnalysisStream(result, board.fen())

    def _restart(self) -> None:
        if self._active_id is not None:
            self._start(self._active_id)

    def _require(self) -> chess.engine.SimpleEngine:
        if self._engine is None:
            raise RuntimeError("No engine selected; call select() first.")
        return self._engine

    def close(self) -> None:
        if self._engine is not None:
            try:
                self._engine.quit()
            except Exception:
                pass  # engine may have already crashed; don't mask the original error
            self._engine = None

    def __enter__(self) -> "EngineManager":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


class AnalysisStream:
    """Iterable of AnalysisInfo snapshots from a running multi-PV search.

    Iterating blocks until the next engine update; each yield rebuilds an
    AnalysisInfo from the handle's latest per-line info. stop() cancels the
    search; usable as a context manager (exit stops it).
    """

    def __init__(self, result: "chess.engine.SimpleAnalysisResult", fen: str):
        self._result = result
        self._fen = fen

    def __iter__(self):
        for _update in self._result:
            scored = [info for info in self._result.multipv if "score" in info]
            if scored:
                yield AnalysisInfo.from_engine(self._fen, scored)

    def stop(self) -> None:
        self._result.stop()

    def __enter__(self) -> "AnalysisStream":
        return self

    def __exit__(self, *exc) -> None:
        self._result.stop()
