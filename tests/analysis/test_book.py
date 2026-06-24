import chess

from chessmenthol.analysis.book import NoBook, PolyglotBook


def test_nobook_never_contains():
    assert NoBook().contains_move(chess.Board(), chess.Move.from_uci("e2e4")) is False


def test_polyglot_missing_file_returns_false(tmp_path):
    book = PolyglotBook(tmp_path / "does-not-exist.bin")
    assert book.contains_move(chess.Board(), chess.Move.from_uci("e2e4")) is False


def test_polyglot_hit_returns_true_and_miss_returns_false(tmp_path):
    import struct

    import chess.polyglot

    book_path = tmp_path / "tiny.bin"
    board = chess.Board()
    move = chess.Move.from_uci("e2e4")
    # Polyglot move encoding (no promotion): bits 0-5 = to square, bits 6-11 = from square.
    raw_move = move.to_square | (move.from_square << 6)
    key = chess.polyglot.zobrist_hash(board)
    entry = struct.pack(">QHHI", key, raw_move, 1, 0)  # 8-byte key, 2 move, 2 weight, 4 learn
    book_path.write_bytes(entry)

    book = PolyglotBook(book_path)
    assert book.contains_move(board, move) is True
    assert book.contains_move(board, chess.Move.from_uci("d2d4")) is False
