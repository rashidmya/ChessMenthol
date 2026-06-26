import pytest
from fastapi.testclient import TestClient

from chessmenthol.server.app import create_app


class FakeOrchestrator:
    """Records commands; can push frames back through `send`."""

    instances = []

    def __init__(self, send):
        self._send = send
        self.commands = []
        self.closed = False
        FakeOrchestrator.instances.append(self)

    def handle(self, cmd):
        self.commands.append(cmd)
        if cmd.get("type") == "ping":
            self._send({"type": "state", "fen": "ok"})
        elif cmd.get("type") == "boom":
            raise RuntimeError("boom happened")

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def _clear_fake_instances():
    FakeOrchestrator.instances.clear()
    yield


def test_ws_round_trip_command_to_state():
    FakeOrchestrator.instances.clear()
    app = create_app(orchestrator_factory=FakeOrchestrator)
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "ping"})
        frame = ws.receive_json()
    assert frame == {"type": "state", "fen": "ok"}
    assert FakeOrchestrator.instances[-1].commands == [{"type": "ping"}]


def test_ws_closes_orchestrator_on_disconnect():
    FakeOrchestrator.instances.clear()
    app = create_app(orchestrator_factory=FakeOrchestrator)
    client = TestClient(app)
    with client.websocket_connect("/ws"):
        pass
    assert FakeOrchestrator.instances[-1].closed is True


def test_health_endpoint():
    app = create_app(orchestrator_factory=FakeOrchestrator)
    client = TestClient(app)
    assert client.get("/healthz").json() == {"status": "ok"}


def test_ws_malformed_json_returns_error_frame():
    app = create_app(orchestrator_factory=FakeOrchestrator)
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text("this is not json")
        frame = ws.receive_json()
    assert frame["type"] == "error"
    assert "JSON" in frame["message"]


def test_ws_handle_exception_returns_error_and_keeps_socket_open():
    app = create_app(orchestrator_factory=FakeOrchestrator)
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "boom"})
        err = ws.receive_json()
        ws.send_json({"type": "ping"})  # socket must still work after a handle error
        ok = ws.receive_json()
    assert err == {"type": "error", "message": "boom happened"}
    assert ok == {"type": "state", "fen": "ok"}


def test_vision_commands_reach_orchestrator():
    FakeOrchestrator.instances.clear()
    app = create_app(orchestrator_factory=FakeOrchestrator)
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "set_auto", "on": True})
        ws.send_json({"type": "capture_now"})
    orch = FakeOrchestrator.instances[-1]
    assert {"type": "set_auto", "on": True} in orch.commands
    assert {"type": "capture_now"} in orch.commands


@pytest.mark.engine
def test_ws_streams_real_analysis_for_set_fen():
    app = create_app()  # real Orchestrator + real Stockfish
    client = TestClient(app)
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "set_options", "depth": 10, "multipv": 2})
        ws.send_json({"type": "set_fen", "fen": fen})
        # Read frames until we see a streamed analysis FOR THIS fen with lines.
        # Filtering on fen avoids a race where a leftover start-position frame
        # (from the set_options analysis) could arrive first.
        got = None
        for _ in range(80):
            frame = ws.receive_json()
            if (frame.get("type") == "state"
                    and frame.get("fen") == fen
                    and frame.get("lines")):
                got = frame
                break
        ws.send_json({"type": "stop"})
    assert got is not None
    assert got["sideToMove"] == "black"
    assert len(got["lines"]) >= 1
    assert "scoreText" in got["lines"][0]
    assert "pv" in got["lines"][0]
