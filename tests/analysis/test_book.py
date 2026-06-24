import chess

from chessmenthol.analysis.book import NoBook, PolyglotBook


def test_nobook_never_contains():
    assert NoBook().contains_move(chess.Board(), chess.Move.from_uci("e2e4")) is False


def test_polyglot_missing_file_returns_false(tmp_path):
    book = PolyglotBook(tmp_path / "does-not-exist.bin")
    assert book.contains_move(chess.Board(), chess.Move.from_uci("e2e4")) is False
