<p align="center">
  <img src="apps/desktop/src/assets/logo.png" alt="ChessMenthol logo" width="420" />
</p>

# ChessMenthol

A cross-platform desktop chess assistant. ChessMenthol watches a chess board on your screen,
recognizes the position with computer vision, and analyzes it with Stockfish — streaming
evaluations, best lines, and chess.com-style move classification (brilliant / great / best / …
/ blunder / miss).

Everything runs **locally and offline**: chess logic and move classification are plain
TypeScript; the board-vision pipeline runs in **WebAssembly** (onnxruntime-web) inside a
**Svelte 5** UI, wrapped in a thin **Tauri 2 (Rust)** shell that does what a web page cannot —
capture the screen and run a **native Stockfish** engine.

## Features

- **Screen-capture board recognition** — drag a box over any on-screen board (chess.com,
  Lichess, a PDF, a video) and ChessMenthol reads the position with computer vision; no
  extension, no account, no upload.
- **Live Stockfish analysis** — evaluation, best move, and multiple principal variations
  (MultiPV) with an eval bar that updates as the position changes.
- **chess.com-style move classification** — every move labeled across 10 classes (brilliant,
  great, best, excellent, good, book, inaccuracy, mistake, blunder, miss).
- **Full-game review** — import a PGN or analyze a captured/played game to get a computer
  report (per-player accuracy %, ACPL, and per-class counts), an eval graph, and a Review mode
  that steps through the game move-by-move with badges and auto-play.
- **Position editor & play** — set up any position by hand, flip the board, and play out moves.
- **Bring-your-own engine** — ships with a native Stockfish, and you can add any external UCI
  engine and tune its options.

## Installation

Download the installer for your OS from the
[**Releases**](https://github.com/rashidmya/ChessMenthol/releases/latest) page.

> The installers are **unsigned**, so each OS shows a first-launch warning — steps to allow the
> app are below. Downloads are large (~200 MB) because the full Stockfish NNUE build is bundled.

### Windows

Run the `.msi` or `.exe`. SmartScreen may warn on an unsigned app — click **More info → Run
anyway**.

### macOS

Open the `.dmg` and drag **ChessMenthol** to Applications. It is unsigned and un-notarized, so
Gatekeeper blocks it on first launch — **right-click the app → Open** (then confirm), or clear
the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/ChessMenthol.app
```

The macOS build is a universal binary (Apple Silicon + Intel).

### Linux

Use the portable `.AppImage`, or install the `.deb` / `.rpm`:

```bash
chmod +x ChessMenthol_*.AppImage && ./ChessMenthol_*.AppImage
```

- **Screen capture** on Wayland compositors without `wlr-screencopy` (KWin/Mutter) shells out
  to a screenshot tool — install one of **`spectacle`** (KDE), **`grim`** (wlroots), or
  **`gnome-screenshot`** (GNOME). X11 captures directly.
- If the window fails to render on Wayland (WebKitGTK DMABUF crash, *"Gdk Error 71"*), launch
  with:
  ```bash
  WEBKIT_DISABLE_DMABUF_RENDERER=1 ./ChessMenthol_*.AppImage
  ```

## Development

The app lives in `apps/desktop/` — a Svelte 5 + TypeScript renderer with the Tauri (Rust) shell under
`apps/desktop/src-tauri/`.

**Prerequisites**

- **Node.js** (LTS) and **npm**
- **Rust** (stable) + the [Tauri 2 system prerequisites](https://tauri.apps/desktop/start/prerequisites/)
  for your OS. On Debian/Ubuntu:
  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
  ```

**Run**

```bash
cd apps/desktop
npm install
npm run tauri dev     # desktop app (screen capture enabled)
```

`npm run dev` serves the renderer in a plain browser for **UI work only** — analysis (native
engine) and screen capture require the desktop app. On some Wayland setups prefix a command
with `WEBKIT_DISABLE_DMABUF_RENDERER=1` (see the Linux notes above).

**Test & type-check**

```bash
cd apps/desktop
npm run test    # Vitest (engine, orchestrator, classify, vision parity)
npm run check   # svelte-check + tsc
```

**Build installers**

```bash
cd apps/desktop
npm run tauri build   # -> apps/desktop/src-tauri/target/release/bundle/
```

Pushing a `v*` tag builds and uploads installers for all three OSes to a draft GitHub Release
(`.github/workflows/release.yml`); PRs and branch pushes run `ci.yml`.

## License

[GPL-3.0-or-later](LICENSE). Third-party components and vendored assets are credited in
[`NOTICE.md`](NOTICE.md).
