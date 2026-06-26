import chess
import pytest

from chessmenthol.engine.types import AnalysisInfo, Eval, Line
from chessmenthol.position import SquareLabel, assemble
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


@pytest.fixture
def make_orchestrator():
    """Builder for an Orchestrator wired with a FakeSession.

    Called with no args -> returns ``(orch, frames, session_holder)`` (legacy
    tests own nothing). Called with ``send=`` -> returns just ``orch`` (the
    caller owns its own frame sink). ``tracker=`` injects a vision tracker.
    """

    def build(*, tracker=None, send=None):
        own_frames = send is None
        frames = [] if own_frames else None
        session_holder = {}

        def factory(engine, on_update):
            s = FakeSession(engine, on_update)
            session_holder["s"] = s
            return s

        sink = frames.append if own_frames else send
        orch = Orchestrator(
            send=sink,
            engine=object(),
            session_factory=factory,
            tracker=tracker,
        )
        if own_frames:
            return orch, frames, session_holder
        return orch

    return build


def test_set_fen_updates_board_and_emits_state(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(fen, -10, [chess.Move.from_uci("e7e5")])]
    orch.handle({"type": "set_fen", "fen": fen})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["fen"] == fen
    assert state["sideToMove"] == "black"
    assert state["eval"]["cp"] == -10


def test_invalid_fen_emits_error_no_crash(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_fen", "fen": "not a fen"})
    assert frames[-1]["type"] == "error"


def test_illegal_move_emits_error(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "make_move", "uci": "e2e5"})  # illegal from start
    assert any(f["type"] == "error" for f in frames)


def test_make_move_advances_board(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    after = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(after, 25, [chess.Move.from_uci("e7e5")])]
    orch.handle({"type": "make_move", "uci": "e2e4"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3")


def test_make_move_classifies_using_prior_analysis(make_orchestrator):
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


def test_set_turn_white_black(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_turn", "white": False})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["sideToMove"] == "black"


def test_set_engine_restarts_session(make_orchestrator):
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


def test_stop_command_emits_idle_state_frame(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_fen", "fen": chess.STARTING_FEN})
    active = [f for f in frames if f["type"] == "state"][-1]
    assert active["analyzing"] is True
    orch.handle({"type": "stop"})
    idle = [f for f in frames if f["type"] == "state"][-1]
    assert idle["analyzing"] is False
    assert holder["s"].stopped >= 1


def test_illegal_move_re_emits_state_so_client_can_revert(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "make_move", "uci": "e2e5"})  # illegal from the start position
    types = [f["type"] for f in frames]
    assert "error" in types
    # a state frame is also sent so the UI re-syncs its board to the real position
    assert "state" in types
    last_state = [f for f in frames if f["type"] == "state"][-1]
    assert last_state["fen"] == chess.STARTING_FEN  # board unchanged


# ---- vision / tracking wiring ----


class FakeTracker:
    def __init__(self, result):
        self.result = result
        self.side_override = None

    def grab_if_changed(self, threshold):
        # Always return a non-None sentinel so _run proceeds to detect_position.
        return object()

    def detect_position(self, frame=None):
        return self.result

    def set_side_override(self, side):
        self.side_override = side

    def set_orientation_override(self, o):
        pass

    def reset(self):
        pass


def _legal_assembled(fen):
    board = chess.Board(fen)
    grid = [[SquareLabel(None, 1.0) for _ in range(8)] for _ in range(8)]
    for sq in chess.SQUARES:
        p = board.piece_at(sq)
        if p:
            grid[7 - chess.square_rank(sq)][chess.square_file(sq)] = SquareLabel(p, 1.0)
    return assemble(grid, orientation="white_bottom", side_to_move=board.turn)


def test_capture_now_legal_detection_drives_set_fen(make_orchestrator):
    target = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(_legal_assembled(target)), send=frames.append)
    orch.handle({"type": "capture_now"})
    assert orch._board.board_fen() == chess.Board(target).board_fen()
    assert frames and frames[-1]["visionStatus"] in ("tracking", "low_confidence")


def test_set_auto_toggles_tracking_state(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    orch.handle({"type": "set_auto", "on": True})
    assert frames[-1]["tracking"] is True
    orch.handle({"type": "set_auto", "on": False})
    assert frames[-1]["tracking"] is False


def test_illegal_detection_does_not_change_board(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    before = orch._board.fen()
    orch.handle({"type": "capture_now"})
    assert orch._board.fen() == before
    assert frames[-1]["visionStatus"] == "searching"


def test_set_turn_sets_tracker_side_override(make_orchestrator):
    import chess
    tracker = FakeTracker(None)
    orch = make_orchestrator(tracker=tracker, send=lambda f: None)
    orch.handle({"type": "set_turn", "white": False})
    assert tracker.side_override == chess.BLACK
