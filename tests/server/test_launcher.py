from chessmenthol.server import launcher


def test_run_server_invokes_uvicorn(monkeypatch):
    calls = {}

    def fake_run(app, host, port, **kwargs):
        calls["host"] = host
        calls["port"] = port
        calls["app"] = app

    monkeypatch.setattr(launcher.uvicorn, "run", fake_run)
    launcher.run_server(host="127.0.0.1", port=53999)
    assert calls["host"] == "127.0.0.1"
    assert calls["port"] == 53999
    assert calls["app"] is not None


def test_run_app_starts_server_thread_then_opens_window(monkeypatch):
    events = []

    def fake_serve(host, port):
        events.append(("serve", host, port))

    def fake_open_window(url):
        events.append(("window", url))

    monkeypatch.setattr(launcher, "_serve_in_thread", fake_serve)
    monkeypatch.setattr(launcher, "_open_window", fake_open_window)
    launcher.run_app(host="127.0.0.1", port=54123)
    assert ("serve", "127.0.0.1", 54123) in events
    assert ("window", "http://127.0.0.1:54123") in events
