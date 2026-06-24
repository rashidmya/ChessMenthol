from __future__ import annotations

import threading
import time

import uvicorn

from .app import create_app

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def run_server(*, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    """Run the FastAPI app under uvicorn (blocking). Entry point: chessmenthol-server."""
    uvicorn.run(create_app(), host=host, port=port, log_level="info")


def _serve_in_thread(host: str, port: int) -> None:
    config = uvicorn.Config(create_app(), host=host, port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    # give uvicorn a moment to bind before the window loads the URL
    time.sleep(1.0)


def _open_window(url: str) -> None:
    import webview  # provided by the optional `desktop` extra (pywebview)

    webview.create_window("ChessMenthol", url, width=1100, height=720)
    webview.start()


def run_app(*, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    """Start the server in a background thread and open a native window.

    Entry point: chessmenthol-app. Requires the `desktop` extra (pywebview).
    """
    _serve_in_thread(host, port)
    _open_window(f"http://{host}:{port}")
