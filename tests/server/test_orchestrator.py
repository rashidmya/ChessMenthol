import chess

from chessmenthol.engine.types import AnalysisInfo, Eval, Line
from chessmenthol.server.orchestrator import Orchestrator


def _analysis(fen, cp, moves, depth=12):
    return AnalysisInfo(fen, depth, [Line(1, Eval(cp=cp), depth, moves)])


class FakeSession:
    """Synchronous stand-in: start() immediately emits queued analyses."""

    def __init__(self, engine, on_update):
        self._on_update = on_update
        self.queue = []          # list of AnalysisInfo to emit on next start()
        self.started = 0
        self.stopped = 0

    def start(self, board, *, depth=None, multipv=None, time_limit=None):
        self.started += 1
        for info in self.queue:
            self._on_update(info, board.copy())
        self.queue = []

    def stop(self):
        self.stopped += 1

    def close(self):
        self.stopped += 1


def make_orchestrator():
    frames = []
    session_holder = {}

    def factory(engine, on_update):
        s = FakeSession(engine, on_update)
        session_holder["s"] = s
        return s

    orch = Orchestrator(send=frames.append, engine=object(), session_factory=factory)
    return orch, frames, session_holder


def test_set_fen_updates_board_and_emits_state():
    orch, frames, holder = make_orchestrator()
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(fen, -10, [chess.Move.from_uci("e7e5")])]
    orch.handle({"type": "set_fen", "fen": fen})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["fen"] == fen
    assert state["sideToMove"] == "black"
    assert state["eval"]["cp"] == -10


def test_invalid_fen_emits_error_no_crash():
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_fen", "fen": "not a fen"})
    assert frames[-1]["type"] == "error"


def test_illegal_move_emits_error():
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "make_move", "uci": "e2e5"})  # illegal from start
    assert frames[-1]["type"] == "error"


def test_make_move_advances_board():
    orch, frames, holder = make_orchestrator()
    after = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(after, 25, [chess.Move.from_uci("e7e5")])]
    orch.handle({"type": "make_move", "uci": "e2e4"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3")


def test_make_move_classifies_using_prior_analysis():
    orch, frames, holder = make_orchestrator()
    holder["s"].queue = [_analysis(chess.STARTING_FEN, 30, [chess.Move.from_uci("e2e4")])]
    orch.handle({"type": "set_fen", "fen": chess.STARTING_FEN})
    after = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(after, 30, [chess.Move.from_uci("e7e5")], depth=12)]
    orch.handle({"type": "make_move", "uci": "e2e4"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["lastMove"]["uci"] == "e2e4"
    assert state["lastMove"]["classification"]["label"] in {
        "best", "great", "excellent", "good", "brilliant", "book", "inaccuracy",
        "mistake", "blunder", "miss",
    }


def test_set_turn_white_black():
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_turn", "white": False})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["sideToMove"] == "black"


def test_set_engine_restarts_session():
    orch, frames, holder = make_orchestrator()
    before = holder["s"].started
    orch.handle({"type": "set_engine", "id": "stockfish_lite"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["engineId"] == "stockfish_lite"
    assert holder["s"].started > before


def test_make_move_stops_session_before_mutating_board():
    frames = []
    log = []
    holder = {}

    class OrderSession:
        def __init__(self, engine, on_update):
            self._on_update = on_update

        def start(self, board, *, depth=None, multipv=None, time_limit=None):
            log.append(("start", board.fen()))

        def stop(self):
            # record the orchestrator's board AT THE MOMENT stop() is called
            log.append(("stop", holder["orch"]._board.fen()))

        def close(self):
            pass

    def factory(engine, on_update):
        s = OrderSession(engine, on_update)
        holder["s"] = s
        return s

    orch = Orchestrator(send=frames.append, engine=object(), session_factory=factory)
    holder["orch"] = orch
    orch.handle({"type": "make_move", "uci": "e2e4"})

    # the session must have been stopped while the board was still the pre-move position
    assert ("stop", chess.STARTING_FEN) in log
    stop_i = log.index(("stop", chess.STARTING_FEN))
    start_indices = [i for i, e in enumerate(log) if e[0] == "start"]
    # ...and (re)started afterwards on the post-move position
    assert start_indices and start_indices[-1] > stop_i
    assert log[start_indices[-1]][1] != chess.STARTING_FEN
