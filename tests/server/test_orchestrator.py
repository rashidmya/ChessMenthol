import chess
import numpy as np
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
        self.last_start_kwargs: dict = {}  # records kwargs from the most recent start()

    def start(self, board, *, depth=None, multipv=None, time_limit=None):
        self.started += 1
        self.last_start_kwargs = {"depth": depth, "multipv": multipv, "time_limit": time_limit}
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
    # Engine prefers d2d4; the player instead plays e2e4 -> played != best, so the
    # two slots are distinguishable (guards against a played/best slot swap).
    holder["s"].queue = [_analysis(chess.STARTING_FEN, 30, [chess.Move.from_uci("d2d4")])]
    orch.handle({"type": "set_fen", "fen": chess.STARTING_FEN})
    after = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(after, 30, [chess.Move.from_uci("e7e5")], depth=12)]
    orch.handle({"type": "make_move", "uci": "e2e4"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["lastMove"]["best"]["uci"] == "d2d4"
    assert state["lastMove"]["best"]["san"] == "d4"
    assert state["lastMove"]["played"]["san"] == "e4"
    assert state["lastMove"]["classification"]["label"] in {
        "best", "great", "excellent", "good", "brilliant", "book", "inaccuracy",
        "mistake", "blunder", "miss",
    }


def test_on_update_tolerates_best_line_without_a_move(make_orchestrator):
    # Defense-in-depth: if the pre-move analysis has a best line whose PV is empty
    # (best.move is None), classification must be SKIPPED, not crash the worker.
    # This is the `analysis_before must contain at least one line with a move`
    # crash from the log, reproduced at the orchestrator boundary.
    orch, frames, holder = make_orchestrator()
    board_before = chess.Board()
    move = chess.Move.from_uci("e2e4")
    broken_before = AnalysisInfo(chess.STARTING_FEN, 18, [Line(1, Eval(cp=30), 18, [])])
    orch._pending = (board_before, move, broken_before, 0)

    after_fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    good_after = _analysis(after_fen, -30, [chess.Move.from_uci("e7e5")], depth=12)

    orch._on_update(good_after, chess.Board(after_fen))  # must not raise

    assert orch._last_move is None      # classification skipped, not bogus
    assert orch._pending is None        # consumed, won't retry forever


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
        self.region = "unset"
        self.full = np.zeros((6, 8, 3), np.uint8)

    def detect_position(self, frame=None):
        return self.result

    def grab_full_desktop(self):
        return self.full

    def set_region(self, region):
        self.region = region

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
    assert frames and frames[-1]["visionStatus"] in ("found", "low_confidence")


def test_illegal_detection_reports_no_board(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    before = orch._board.fen()
    orch.handle({"type": "capture_now"})
    assert orch._board.fen() == before
    assert frames[-1]["visionStatus"] == "no_board"


def test_set_turn_sets_tracker_side_override(make_orchestrator):
    tracker = FakeTracker(None)
    orch = make_orchestrator(tracker=tracker, send=lambda f: None)
    orch.handle({"type": "set_turn", "white": False})
    assert tracker.side_override == chess.BLACK


def test_request_region_shot_emits_region_shot_frame(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    orch.handle({"type": "request_region_shot"})
    shot = [f for f in frames if f["type"] == "region_shot"][-1]
    assert shot["width"] == 8 and shot["height"] == 6
    assert isinstance(shot["jpegBase64"], str) and shot["jpegBase64"]


def test_set_region_stores_and_captures(make_orchestrator):
    target = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    frames = []
    tracker = FakeTracker(_legal_assembled(target))
    orch = make_orchestrator(tracker=tracker, send=frames.append)
    orch.handle({"type": "set_region", "left": 5, "top": 6, "width": 100, "height": 120})
    assert tracker.region.left == 5 and tracker.region.width == 100
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["region"] == {"left": 5, "top": 6, "width": 100, "height": 120}
    assert orch._board.board_fen() == chess.Board(target).board_fen()  # captured


def test_set_region_rejects_bad_rectangle(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    orch.handle({"type": "set_region", "left": 0, "top": 0, "width": 0, "height": 10})
    assert frames[-1]["type"] == "error"


def test_clear_region_resets(make_orchestrator):
    frames = []
    tracker = FakeTracker(None)
    orch = make_orchestrator(tracker=tracker, send=frames.append)
    orch.handle({"type": "set_region", "left": 1, "top": 1, "width": 10, "height": 10})
    orch.handle({"type": "clear_region"})
    assert tracker.region is None
    assert frames[-1]["region"] is None


def test_capture_now_exception_emits_error_and_no_board_status(make_orchestrator):
    class ErrorTracker(FakeTracker):
        def detect_position(self, frame=None):
            raise OSError("no display")

    frames = []
    orch = make_orchestrator(tracker=ErrorTracker(None), send=frames.append)
    orch.handle({"type": "capture_now"})
    assert frames[-1]["type"] == "error"
    assert orch._vision_status == "no_board"


def test_request_region_shot_grab_failure_emits_error(make_orchestrator):
    class GrabFailTracker(FakeTracker):
        def grab_full_desktop(self):
            raise OSError("no display")

    frames = []
    orch = make_orchestrator(tracker=GrabFailTracker(None), send=frames.append)
    orch.handle({"type": "request_region_shot"})
    assert frames[-1]["type"] == "error"


def test_set_region_missing_keys_errors(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    orch.handle({"type": "set_region"})
    assert frames[-1]["type"] == "error"


class RecordingEngine:
    """Engine stub that records select()/configure() calls (no real binary)."""

    def __init__(self):
        self.selected = []
        self.configured = []

    def select(self, engine_id):
        self.selected.append(engine_id)

    def configure(self, *, threads=None, hash_mb=None, multipv=None):
        self.configured.append((threads, hash_mb))


def test_engine_options_persist_across_engine_switch():
    holder = {}

    def factory(engine, on_update):
        s = FakeSession(engine, on_update)
        holder["s"] = s
        return s

    engine = RecordingEngine()
    orch = Orchestrator(send=lambda f: None, engine=engine, session_factory=factory)
    orch.handle({"type": "set_options", "threads": 4, "hash": 128})
    orch.handle({"type": "set_engine", "id": "stockfish_lite"})
    assert engine.selected[-1] == "stockfish_lite"
    assert engine.configured[-1] == (4, 128)  # user options re-applied to the new engine


def test_play_best_replays_best_using_retained_analysis(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    # Deep analysis of the start position: engine's best move is d2d4.
    holder["s"].queue = [_analysis(chess.STARTING_FEN, 30, [chess.Move.from_uci("d2d4")])]
    orch.handle({"type": "set_fen", "fen": chess.STARTING_FEN})
    # Player plays e2e4 instead; classifying it retains the deep start analysis.
    after_e4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(after_e4, 30, [chess.Move.from_uci("e7e5")], depth=12)]
    orch.handle({"type": "make_move", "uci": "e2e4"})
    # Click "play best" (d2d4): pop e4, replay d4, reuse the retained deep analysis.
    after_d4 = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(after_d4, 25, [chess.Move.from_uci("g8f6")], depth=12)]
    orch.handle({"type": "play_best", "uci": "d2d4"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["fen"].startswith("rnbqkbnr/pppppppp/8/8/3P4")   # d4 is on the board
    assert state["lastMove"]["classification"]["isBest"] is True
    assert state["lastMove"]["best"]["uci"] == "d2d4"
    assert state["lastMove"]["played"]["san"] == "d4"
    # --- history/cursor regression-lock ---
    # play_best must REPLACE the played move (e4), not append after it.
    # If _cursor -= 1 is missing or doubled, these fire.
    assert state["currentPly"] == len(state["moveList"])   # cursor at the tip
    sans = [e["san"] for e in state["moveList"]]
    assert sans[-1] == "d4"        # best move is the last (and only) entry
    assert "e4" not in sans        # the sub-optimal played move is gone
    assert len(state["moveList"]) == 1  # count did not grow by two


def test_play_best_noop_without_retained_analysis(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    holder["s"].queue = [_analysis(chess.STARTING_FEN, 20, [chess.Move.from_uci("e2e4")])]
    orch.handle({"type": "set_fen", "fen": chess.STARTING_FEN})
    # No move has been classified yet -> no retained analysis -> play_best is a safe no-op.
    stopped_before = holder["s"].stopped
    orch.handle({"type": "play_best", "uci": "e2e4"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["fen"] == chess.STARTING_FEN          # board unchanged
    assert state["lastMove"] is None
    assert holder["s"].stopped == stopped_before       # no-op must not stop the session


# ---- explicit move history ----


def test_make_move_appends_to_move_list(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "make_move", "uci": "e2e4"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["currentPly"] == 1
    assert len(state["moveList"]) == 1
    entry = state["moveList"][0]
    assert entry["ply"] == 1
    assert entry["san"] == "e4"
    assert entry["uci"] == "e2e4"
    assert entry["classification"] is None  # not yet classified (no deep analysis)


def test_navigate_from_past_truncates_forward_line(make_orchestrator):
    # e4, e5, navigate back to ply 1, then c5 -> replaces e5 with c5.
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "make_move", "uci": "e2e4"})
    orch.handle({"type": "make_move", "uci": "e7e5"})
    orch.handle({"type": "navigate", "index": 1})  # step back to after e4
    orch.handle({"type": "make_move", "uci": "c7c5"})  # Sicilian; replaces e5
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["currentPly"] == 2
    sans = [e["san"] for e in state["moveList"]]
    assert sans == ["e4", "c5"]


def test_navigate_clamps_to_zero(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "make_move", "uci": "e2e4"})
    orch.handle({"type": "navigate", "index": 0})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["currentPly"] == 0
    # FEN should be the starting position (base_fen, no moves applied).
    assert state["fen"] == chess.STARTING_FEN


def test_navigate_clamps_to_tip(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "make_move", "uci": "e2e4"})
    orch.handle({"type": "navigate", "index": 99})  # beyond tip (length==1)
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["currentPly"] == 1  # clamped to tip


def test_reset_clears_history(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "make_move", "uci": "e2e4"})
    orch.handle({"type": "reset"})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["moveList"] == []
    assert state["currentPly"] == 0
    assert state["fen"] == chess.STARTING_FEN


def test_set_fen_starts_fresh_line(make_orchestrator):
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "make_move", "uci": "e2e4"})
    orch.handle({"type": "make_move", "uci": "e7e5"})
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    orch.handle({"type": "set_fen", "fen": fen})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["moveList"] == []
    assert state["currentPly"] == 0


def test_classification_lands_in_move_list(make_orchestrator):
    # Mirrors test_make_move_classifies_using_prior_analysis but also checks
    # that the classification is stored in moveList[0].classification.
    orch, frames, holder = make_orchestrator()
    # Provide deep analysis of starting position so classification is triggered.
    holder["s"].queue = [_analysis(chess.STARTING_FEN, 30, [chess.Move.from_uci("d2d4")])]
    orch.handle({"type": "set_fen", "fen": chess.STARTING_FEN})
    after_e4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    holder["s"].queue = [_analysis(after_e4, 30, [chess.Move.from_uci("e7e5")], depth=12)]
    orch.handle({"type": "make_move", "uci": "e2e4"})
    state = [f for f in frames if f["type"] == "state"][-1]
    # lastMove should be populated (overall classification pipeline works).
    assert state["lastMove"] is not None
    # The classification should also be stored inside moveList.
    assert len(state["moveList"]) == 1
    entry = state["moveList"][0]
    assert entry["classification"] is not None
    assert entry["classification"]["label"] in {
        "best", "great", "excellent", "good", "brilliant", "book",
        "inaccuracy", "mistake", "blunder", "miss",
    }


# ---- movetime / set_options ----


def test_set_options_movetime_5000_passes_time_limit_to_session(make_orchestrator):
    """set_options with movetime=5000 ms must start the session with time_limit=5.0."""
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_options", "movetime": 5000})
    assert holder["s"].last_start_kwargs["time_limit"] == 5.0


def test_set_options_movetime_none_passes_time_limit_none_to_session(make_orchestrator):
    """set_options with movetime=None (infinite) must start the session with time_limit=None."""
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_options", "movetime": None})
    assert holder["s"].last_start_kwargs["time_limit"] is None


def test_set_options_movetime_zero_passes_time_limit_none_to_session(make_orchestrator):
    """set_options with movetime=0 (infinite) must start the session with time_limit=None."""
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_options", "movetime": 0})
    assert holder["s"].last_start_kwargs["time_limit"] is None


# ---- analysis on/off gate ----


def test_disable_analysis_state_frame_reflects_disabled(make_orchestrator):
    """After set_analysis_enabled=False the latest state frame has analysisEnabled=False
    and analyzing=False."""
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_analysis_enabled", "enabled": False})
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["analysisEnabled"] is False
    assert state["analyzing"] is False


def test_make_move_while_disabled_does_not_start_analysis(make_orchestrator):
    """While analysis is disabled, make_move must NOT call session.start(), but
    the move must still be recorded (history is independent of analysis)."""
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_analysis_enabled", "enabled": False})
    # Reset the counter so we only measure starts triggered by the move.
    holder["s"].started = 0
    orch.handle({"type": "make_move", "uci": "e2e4"})
    assert holder["s"].started == 0, "session.start() must not be called while analysis is disabled"
    state = [f for f in frames if f["type"] == "state"][-1]
    assert len(state["moveList"]) == 1
    assert state["currentPly"] == 1


def test_re_enable_analysis_restarts_session_exactly_once(make_orchestrator):
    """Re-enabling analysis must call session.start() exactly once."""
    orch, frames, holder = make_orchestrator()
    orch.handle({"type": "set_analysis_enabled", "enabled": False})
    holder["s"].started = 0
    orch.handle({"type": "set_analysis_enabled", "enabled": True})
    assert holder["s"].started == 1


def test_on_search_done_sets_analyzing_false(make_orchestrator):
    """_on_search_done flips analyzing off and emits a frozen state frame."""
    orch, frames, _ = make_orchestrator()
    # Simulate a search that completed naturally while analyzing was True.
    orch._analyzing = True
    orch._on_search_done()
    last = [f for f in frames if f["type"] == "state"][-1]
    assert last["analyzing"] is False
    assert orch._analyzing is False
