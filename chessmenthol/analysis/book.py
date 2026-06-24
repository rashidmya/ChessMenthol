from __future__ import annotations

from pathlib import Path
from typing import Protocol

import chess
import chess.polyglot


class BookLookup(Protocol):
    def contains_move(self, board: chess.Board, move: chess.Move) -> bool: ...


class NoBook:
    """Null book: nothing is ever a book move."""

    def contains_move(self, board: chess.Board, move: chess.Move) -> bool:
        return False


class PolyglotBook:
    """Looks moves up in a Polyglot (.bin) opening book."""

    def __init__(self, path: Path):
        self._path = Path(path)

    def contains_move(self, board: chess.Board, move: chess.Move) -> bool:
        try:
            with chess.polyglot.open_reader(self._path) as reader:
                return any(entry.move == move for entry in reader.find_all(board))
        except (FileNotFoundError, IndexError, OSError):
            return False
