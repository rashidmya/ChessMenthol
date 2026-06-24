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

    def close(self):
        self.closed = True


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
