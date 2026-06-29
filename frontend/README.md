# ChessMenthol — frontend (Svelte 5 + Tauri 2)

This is the ChessMenthol application: a Svelte 5 + TypeScript renderer and a thin
Tauri (Rust) shell under `src-tauri/`. The engine (stockfish.wasm), chess logic
(chessops), and board vision (onnxruntime-web) all run in the web/WASM layer.

See the [root README](../README.md) for architecture, prerequisites, and the
dev / test / build / release instructions.

- `npm run tauri dev` — run the desktop app (vision enabled)
- `npm run dev` — run as an analysis-only website (no capture)
- `npm run test` — Vitest suite
- `npm run tauri build` — produce native installers
