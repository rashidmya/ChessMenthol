# ChessMenthol — Notices

ChessMenthol — a cross-platform desktop chess assistant.
Copyright (C) 2026 rashidmya

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with
this program. If not, see <https://www.gnu.org/licenses/>. A verbatim copy is
included in the [`LICENSE`](LICENSE) file at the root of this repository.

## Third-party components

This project bundles and/or links third-party components, each under its own
license. The notable copyleft components requiring compliance are:

- **Stockfish (WASM build)** — GNU General Public License v3.0 or later.
  The chess engine, compiled to WebAssembly and run in a Web Worker via the
  `stockfish` npm package; driven over the UCI protocol in TypeScript.
  Corresponding source: <https://github.com/official-stockfish/Stockfish>

- **chessground** (`@lichess-org/chessground`) — GNU General Public License
  v3.0 or later. The board UI library linked into the web frontend.
  Corresponding source: <https://github.com/lichess-org/chessground>

- **chessops** (`chessops`) — GNU General Public License v3.0 or later.
  Chess move generation, SAN/FEN, and game-outcome logic.
  Corresponding source: <https://github.com/niklasf/chessops>

- **Chess Figurine font** (`frontend/src/assets/fonts/chess-figurine.woff2`) —
  GNU General Public License v2.0 or later. The figurine-notation webfont by the
  pgn4web authors (the same font Lichess ships as `lichess-chess.woff2`); it
  renders piece letters as chess glyphs in move lists. Corresponding source
  (FontForge `.sfd`): <https://github.com/lichess-org/lila/tree/master/public/font>

- **Lichess icon font** (`frontend/src/assets/fonts/lichess.woff2`) — GNU Affero
  General Public License v3.0 or later. The UI icon webfont from lila, rendered via
  the `licon` name→codepoint map vendored at `frontend/src/lib/licon.ts`; it provides
  the toolbar, navigation, and control glyphs. Corresponding source (FontForge `.sfd`
  + the generated `licon.ts`): <https://github.com/lichess-org/lila/tree/master/public/font>
  and <https://github.com/lichess-org/lila/blob/master/ui/lib/src/licon.ts>

Permissively-licensed components (informational):

- **Tauri** (`tauri`, `@tauri-apps/api`) — Apache-2.0 OR MIT. The desktop shell.
- **xcap** — Apache-2.0. Screen capture in the Rust shell.
- **onnxruntime-web** — MIT. Runs the bundled `pieces.onnx` piece classifier.

The `pieces.onnx` model (`frontend/models/pieces.onnx`) is a project artifact
bundled as-is.
