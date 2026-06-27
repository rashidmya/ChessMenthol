# Editorial Slate Redesign + Foundation — Design (Spec 1)

- **Date:** 2026-06-27
- **Status:** Approved (brainstorming)
- **Source of truth for the look:** `docs/frontend-redesign-editorial-slate.html` (finalized mockup)
- **Related:** memory `m5-frontend-redesign`, `milestone-roadmap`, `cross-platform-executables`

## 1. Context

The ChessMenthol frontend (`frontend/`, Svelte 5 + chessground) is being redesigned to the
finalized "Editorial Slate" mockup. Beyond the visual port, the mockup shows features the app
does not have yet: a move-history list, `« ‹ › »` navigation + redo, Reset Board, Search-time /
Memory engine options, four client-side view toggles, and a region-gated Capture button.

The backend (`chessmenthol/server/*`, `chessmenthol/engine/*`) today holds a **single
`chess.Board`** with its internal move stack; `undo()` pops the tip; only the **last** move is
classified and serialized. `movetime` and `hash` are supported in the engine layer but `movetime`
is not wired through `set_options`. `visionStatus` already distinguishes
`found` / `no_board` / `low_confidence` / `idle`.

## 2. Scope

This is **Spec 1 of three** (the work was deliberately decomposed):

- **Spec 1 (this doc):** full visual port + a **linear** move-history foundation.
- **Spec 2 (deferred):** variation/branch tree (backend tree model + branch-switching UI — needs
  its own design; the mockup has no branch UI).
- **Spec 3 (deferred):** full-game retroactive auto-analysis (classify every move + progress UX —
  needs its own design).

### 2.1 In scope

1. Visual port of the mockup into Svelte components (theme, layout, board/eval restyle, the
   single full-height analysis card with all its sections, cog/menu popovers).
2. **Linear move-history** list with classify-on-play coloring.
3. **Navigation + redo:** `« ‹ › »` (first/prev/next/last) and click-a-move; non-destructive.
4. **Search time** (`2s/5s/10s/20s/30s/∞`) and **Memory** (hash MB) engine options.
5. **Reset Board** command.
6. **Analysis on/off** master switch.
7. Four **view toggles** (Evaluation Bar, Engine Lines, Suggestion Arrows, Move Feedback),
   client-side, persisted to `localStorage`.
8. **Region-gated Capture** (Capture disabled until a region is set) + "Board Undetected" status.

### 2.2 Non-goals (deferred)

- Variation/branch tree. History is strictly **linear** in Spec 1.
- Full-game retroactive analysis. Positions reached via FEN paste / vision capture / moves played
  before analysis was deep enough remain **uncolored** in the move list until Spec 3.
- Any change to the vision/detection pipeline itself (we only consume the existing `visionStatus`).

## 3. Behavioral specification

### 3.1 Linear move history

- The backend keeps the full ply list as `HistoryEntry { move, san, classification|None,
  last_move|None }` plus a **cursor** (count of plies applied from the base position).
- A move's `classification` is filled in when it is played **live** and analysis reaches the
  existing classify-depth threshold (reuses today's classifier). Until then it is `None`
  (renders neutral). This is **classify-on-play** — no retroactive pass.
- Forward plies (those after the cursor) are **retained** so redo works.

### 3.2 Navigation + redo

- `« ‹ › »` and clicking a move issue `navigate{index}`. The backend rebuilds the working
  position at that ply and **re-analyzes it live** — eval bar, engine lines, and move feedback all
  reflect the viewed ply.
- **Redo = next** (`navigate(cursor+1)`); **first/last** = `navigate(0)` / `navigate(len)`.
- Playing a **new** move while the cursor is behind the tip **truncates** the forward plies
  (standard analysis-board behavior).
- The destructive `undo` button is **retired from the UI** in favor of non-destructive
  `navigate`. (`play_best` performs the only destructive truncation a user can trigger.)

### 3.3 Move feedback panel

- Reflects the move at the **current cursor**, using that ply's stored classification + best/PV
  (when it was computed live). For cursor `0` (start position) the panel is empty.
- "Undo & play best" truncates to the prior ply and plays the stored best move.

### 3.4 Analysis switch + search time

- **Analysis switch** is the master enable. ON → analyze each position per the search-time
  setting; OFF → never auto-analyze. This requires a backend `analysis_enabled` flag because the
  orchestrator auto-starts analysis on every position change today.
- **Search time:**
  - `∞` → continuous live search; the `depth NN` tag climbs as it searches.
  - finite (2/5/10/20/30 s) → search that long, then **stop and hold** the result: eval/lines
    freeze, `analyzing` becomes `false`, the `depth NN` tag shows the depth reached. Re-triggers
    on each new position (move, navigate, set_fen, set_turn) while the switch is ON.
  - Default **10s** (matches the mockup).
- Note: with a short search time a move may not reach classify-depth, so it stays uncolored.
  Acceptable under classify-on-play.

### 3.5 Engine options (cog popover)

- **Engine** select, **Lines** `0–5` (multipv; `0` hides engine lines), **Search time**,
  **Threads** `2–32`, **Memory** `16/32/64/128/256/512 MB`.
- Lines/Threads/Memory/Search-time map to `set_options` (`multipv`/`threads`/`hash`/`movetime`).

### 3.6 Reset / Region-gated Capture / View toggles

- **Reset Board** → `reset`: startpos, history cleared, cursor `0`.
- **Capture** is disabled until a region is set (`region != null`). **Select Region** opens the
  existing region picker; **Clear Selection** sends `clear_region`. **"Board Undetected"** shows
  when `visionStatus === 'no_board'`; **"N uncertain"** on `low_confidence`; nothing on
  `found`/`idle`.
- **View toggles** (Eval Bar / Engine Lines / Arrows / Move Feedback) are client-side show/hide,
  default all on, persisted to `localStorage`.

## 4. Protocol changes (`frontend/src/lib/types.ts` + backend)

### 4.1 Commands

New / changed:

```ts
| { type: 'navigate'; index: number }            // plies applied from base; clamped to [0, len]
| { type: 'reset' }                              // startpos + clear history
| { type: 'set_analysis_enabled'; enabled: boolean }
| { type: 'set_options'; depth?: number; multipv?: number; threads?: number;
    hash?: number; movetime?: number | null }    // movetime ms; null/0 = infinite
```

- `play_best` keeps its shape `{ type: 'play_best'; uci }`; new semantics = truncate to the prior
  ply, then `make_move(uci)`.
- Existing commands kept: `set_fen`, `set_turn`, `make_move`, `set_engine`, `stop`,
  `capture_now`, `request_region_shot`, `set_region`, `clear_region`. The `undo` handler may be
  kept for back-compat but is no longer used by the UI.

### 4.2 State frame additions

```ts
interface MoveEntryDto { ply: number; san: string; uci: string;
  classification: ClassificationDto | null }     // ply is 1-based

interface StateFrame {
  // ...all existing fields unchanged...
  moveList: MoveEntryDto[];
  currentPly: number;        // cursor; 0 = base position
  analysisEnabled: boolean;
  movetime: number | null;   // ms; null = ∞
}
```

- `lastMove` now equals the stored entry for the move at `currentPly`
  (`history[currentPly-1].last_move`), or `null` when `currentPly === 0`.

## 5. Backend design

### 5.1 History model — chosen: option A

Hold an explicit history list + cursor, decoupled from the live board:

- `self._base_fen: str` — the position the line starts from (startpos, or a pasted/edited FEN).
- `self._history: list[HistoryEntry]` — `HistoryEntry { move: chess.Move, san: str,
  classification: Optional[Classification], last_move: Optional[dict] }`.
- `self._cursor: int` — plies applied (`0..len`).
- The working board is rebuilt by replaying `base_fen` + `history[:cursor]`.

Rejected: (B) reuse `board.move_stack` + redo stack + parallel classification dict — couples
storage and is awkward for jump-to-index. (C) per-ply FEN snapshots — breaks the move-stack
semantics `play_best`/classification rely on and uses more memory.

### 5.2 Orchestrator operations

- `make_move(uci)`: if `cursor < len`, truncate `history` to `[:cursor]`; push move; record `san`;
  append entry (classification pending); `cursor = len`; capture pre-move analysis; restart.
- `navigate(index)`: clamp; set `cursor`; rebuild board; set `_last_move` from the cursor entry;
  restart (if enabled).
- `reset()`: `base_fen = STARTPOS`; clear history; `cursor = 0`; restart.
- `set_fen(fen)` / `set_turn(...)`: set a fresh `base_fen` (flip side-to-move for `set_turn`),
  clear history, `cursor = 0`. (A pasted/edited position starts a new line.)
- `set_analysis_enabled(enabled)`: store flag; `_restart()` is a no-op (stops) when disabled.
- Classification: when `_on_update` classifies the pending move, store the `Classification` **and**
  the full `last_move` dict into the corresponding `HistoryEntry`, so `moveList` colors and the
  feedback panel both read from history.

### 5.3 Search-time / movetime + analysis lifecycle

- `set_options` extracts `movetime` (ms → seconds; `None`/`0` ⇒ infinite) into `self._movetime`
  (default 10s). `_restart` passes it to `session.start(..., time_limit=self._movetime)`.
- When a finite search completes, the session must signal "done" so the orchestrator sets
  `analyzing = false` and emits a final state frame that **holds** the last eval/lines.
  (Add an on-done callback / detect thread completion in `AnalysisSession`.)

### 5.4 Engine display names

Map engine ids → labels on the frontend (`stockfish` → "Stockfish 16",
`stockfish_lite` → "Stockfish Lite") for Spec 1. Backend stays id-based. (A backend-provided
engine list with labels is a possible later refinement, not required here.)

## 6. Frontend design

### 6.1 Theme

- Add the three Google fonts (Fraunces, Hanken Grotesk, Space Mono) and the mockup's CSS variables
  to `app.css`; light Editorial Slate palette.
- Restyle the chessground board to the mockup's wood squares + coordinates via **CSS only** —
  chessground continues to own piece movement and the eval/edit interactions.

### 6.2 Component decomposition (mirrors the mockup)

- `Header` — brand + "Chess Analysis" kicker (drop the connection pill).
- `EvalBar` — redesigned vertical 30px bar; white fill height = `whitePct`; score shown **without**
  +/- sign (magnitude; mate as `M5`).
- `Board` (existing chessground) + `BoardControls` — turn segment (White/Black) + flip icon.
- Analysis card, composed of:
  - `EngineHeader` — Analysis `Switch`, `depth NN | <engine>` tag, cog button, menu button.
  - `EngineSettings` — cog popover: engine select + four `RangeSlider`s (Lines, Search time,
    Threads, Memory).
  - `ViewMenu` — menu popover: four `Switch` view toggles.
  - `Lines` — engine-line rows: eval pill (keeps +/- sign; pos/neg styling) + PV (figurines) +
    expand chevron (reveals full line).
  - `MoveFeedback` — chess.com-style flat rows (renames/replaces `LastMove`); badges keep +/- sign;
    best row is the "undo & play best" button.
  - `MoveHistory` — scrollable two-column list; figurines; classification colors; current ply
    highlighted; click-to-navigate; `min-height` on the flex parent so it can't overflow controls.
  - `SourceControls` — Capture (disabled until region) / Select Region / Clear Selection +
    "Board Undetected" status.
  - `PositionControls` — paste-FEN + Set; Edit Board (toggles to Done) + Reset Board.
  - `ActionBar` — centered `« ‹ › »` nav.
- Reusable `Switch` and `RangeSlider` (value chip + label support). Keep `EditPalette`,
  `RegionOverlay`.

### 6.3 New libs / state

- `lib/options.ts` — `SEARCH_TIMES` (`[2s,5s,10s,20s,30s,∞]` → ms|null), `MEMORY_MB`
  (`[16,32,64,128,256,512]`), slider index↔value helpers.
- Move-list helpers — classification label → CSS class (`blun/mist/good/best/brill/inacc`); reuse
  existing `toFigurine`.
- `App` holds the four view-toggle booleans (+ `localStorage` persistence) and the analysis-enabled
  / search-time UI state; threads/memory/lines slider state lives in `EngineSettings`.

## 7. Testing strategy (TDD)

Follow the project's existing TDD conventions (vitest for Svelte/TS, pytest for Python).

- **Backend (pytest):** history truncate-on-branch, navigate clamp + rebuild, redo via next, reset,
  classify-on-play stored into the right entry, `moveList`/`currentPly`/`analysisEnabled`/`movetime`
  serialization, movetime plumbing through `set_options`, analysis-enabled gating, finite-search
  "hold" lifecycle, `play_best` truncate semantics, `set_fen`/`set_turn` reset the line.
- **Frontend (vitest):** `options.ts` mappings, EvalBar fill + unsigned score formatting, Lines
  pill sign + expand, MoveFeedback rows, MoveHistory rendering + click→`navigate`, ActionBar
  nav→`navigate`, region-gated Capture disabled state, view toggles + persistence, EngineSettings
  sliders → `set_options`, Analysis switch → `set_analysis_enabled`.

## 8. Execution phasing (for the plan)

1. **Backend foundation:** history model + `navigate`/`reset`/`set_analysis_enabled`, movetime
   plumbing, finite-search hold, classification-into-history, state-frame additions. Wire `types.ts`.
2. **Theme + shell:** fonts/variables, app layout, board + eval restyle, `Header`,
   `BoardControls`, `Switch`/`RangeSlider`.
3. **Card sections:** `EngineHeader` + popovers (`EngineSettings`, `ViewMenu`), `Lines`,
   `MoveFeedback`, `MoveHistory`, `SourceControls`, `PositionControls`, `ActionBar`.
4. **Cross-cutting + polish:** view toggles + persistence, region-gating + status, navigation
   wiring end-to-end, visual fidelity pass against the mockup, full test/lint/check green.

## 9. Open questions / future specs

- Variation tree (Spec 2): branch model + branch-switching UI design.
- Full-game auto-analysis (Spec 3): background classification pass + progress UX.
- Optional later: backend-provided engine list with display labels.
