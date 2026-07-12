# ChessMenthol — app (Svelte 5 + Tauri 2)

This is the ChessMenthol application: a Svelte 5 + TypeScript renderer and a thin
Tauri (Rust) shell under `src-tauri/`. Chess logic (chessops, plain TypeScript) and
board vision (onnxruntime-web, WebAssembly) run in the renderer; the engine is a
native Stockfish process run as a Tauri sidecar.

See the [root README](../README.md) for architecture, prerequisites, and the
dev / test / build / release instructions.

- `npm run tauri dev` — run the desktop app (vision enabled)
- `npm run dev` — renderer in a plain browser, UI-only (no engine, no capture)
- `npm run test` — Vitest suite
- `npm run tauri build` — produce native installers
