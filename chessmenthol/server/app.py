from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Callable, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .orchestrator import Orchestrator

OrchestratorFactory = Callable[[Callable[[dict], None]], object]

_STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app(*, orchestrator_factory: Optional[OrchestratorFactory] = None) -> FastAPI:
    factory = orchestrator_factory or (lambda send: Orchestrator(send=send))
    app = FastAPI(title="ChessMenthol")

    @app.get("/healthz")
    def healthz() -> JSONResponse:
        return JSONResponse({"status": "ok"})

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def send(frame: dict) -> None:
            # Called from any thread (the analysis worker). Hand off to the loop.
            asyncio.run_coroutine_threadsafe(queue.put(frame), loop)

        orch = factory(send)

        async def pump() -> None:
            while True:
                frame = await queue.get()
                await websocket.send_json(frame)

        pump_task = asyncio.create_task(pump())
        try:
            while True:
                cmd = await websocket.receive_json()
                orch.handle(cmd)
        except WebSocketDisconnect:
            pass
        finally:
            pump_task.cancel()
            orch.close()

    # Serve the built frontend if present (Milestone 2b produces it).
    if _STATIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")

    return app
