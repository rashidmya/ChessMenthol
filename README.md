# ChessMenthol

A cross-platform desktop chess assistant. ChessMenthol watches a chess board on
your screen, recognizes the position with computer vision, and analyzes it with
Stockfish — streaming evaluations, best lines, and chess.com-style move
classification (brilliant / great / best / … / blunder / miss).

The engine, chess logic, move classification, and board-vision pipeline all run
in **WebAssembly** inside a **Svelte 5** UI. A thin **Tauri (Rust)** shell does
only one native thing a web page cannot: capture the screen.

## Architecture

```
Tauri shell (Rust, thin)        Renderer (Svelte 5 + TypeScript)
  capture_frame() -> RGBA   →     core/orchestrator.ts  (board, history, classify)
  (xcap; Wayland CLI fallback)    engine: stockfish.wasm  (Web Worker, UCI in TS)
                                  vision: detect.ts + onnxruntime-web (Web Worker)
                                  chess rules: chessops
```

There is no Python and no localhost server — the previous FastAPI backend and its
WebSocket protocol were removed in the Svelte + Tauri migration (see
`docs/superpowers/specs/2026-06-28-svelte-tauri-migration-design.md`).

## Engines

Two engine presets, selectable in the UI:

- **Stockfish Lite** (default) — the ~7 MB WASM build; fast to load, light first run.
- **Stockfish** — the full ~108 MB NNUE build; stronger, loaded on demand when you
  select it (the engine worker reloads on switch).

Both run as `stockfish.wasm` in a Web Worker (threaded when `SharedArrayBuffer` is
available, single-threaded otherwise). Because the full build is bundled for the
strong preset, the installers are large (~200 MB+).

## Prerequisites

- **Node.js** (LTS) and **npm**
- **Rust** (stable) + the [Tauri 2 system prerequisites](https://tauri.app/start/prerequisites/)
  for your OS. On Debian/Ubuntu Linux:
  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
  ```

## Develop

```bash
cd frontend
npm install
npm run tauri dev
```

The app also runs as an **analysis-only website** (no screen capture) with
`npm run dev` — vision is enabled only under the Tauri desktop shell.

### Linux / Wayland notes

- **WebKitGTK rendering:** on some Wayland compositors (e.g. KDE Plasma / KWin),
  WebKitGTK's DMABUF renderer crashes ("Gdk Error 71 Protocol error"). If the
  window fails to render, launch with:
  ```bash
  WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
  # and for a packaged build:
  WEBKIT_DISABLE_DMABUF_RENDERER=1 ./ChessMenthol
  ```
- **Screen capture:** on Wayland compositors without `wlr-screencopy`
  (KWin/Mutter), ChessMenthol shells out to a screenshot tool for capture.
  Install one of: **`spectacle`** (KDE), **`grim`** (wlroots), or
  **`gnome-screenshot`** (GNOME). X11, Windows, and macOS capture directly.

## Test

```bash
cd frontend
npm run test            # Vitest (engine, orchestrator, classify, vision parity)
npx tsc -p tsconfig.app.json --noEmit
npx svelte-check --tsconfig ./tsconfig.app.json
```

## Build installers

```bash
cd frontend
npm run tauri build
```

Produces native installers under `frontend/src-tauri/target/release/bundle/`:
Windows `.msi`/`.exe`, macOS `.dmg`/`.app`, Linux `.AppImage`/`.deb`.

> Installers are **unsigned**. macOS Gatekeeper / Windows SmartScreen will warn on
> first launch; allow the app manually (right-click → Open on macOS).

> Linux `.AppImage` bundling runs `linuxdeploy`, which needs **FUSE**. On a host
> without FUSE, prefix the build with `APPIMAGE_EXTRACT_AND_RUN=1` (CI runners
> already have FUSE). The `.deb`/`.rpm` bundles don't need it.

## Release

Push a version tag and CI builds + uploads all three OSes' installers to a draft
GitHub Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The matrix is defined in `.github/workflows/release.yml`; PRs and branch pushes
run `.github/workflows/ci.yml` (tests + a build-only smoke).

## License

GPL-3.0-or-later. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).
