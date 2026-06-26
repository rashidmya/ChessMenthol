# Milestone 5a — Interaction & Correction — Design Spec

**Date:** 2026-06-26
**Status:** Approved for planning
**Parent:** Milestone 5 (Polish + packaging), decomposed into M5a (this), M5b (region select), M5c (packaging).

## 1. Overview

M5a makes ChessMenthol usable as a live assistant rather than a passive viewer: you can
**correct a misdetected piece**, **explore variations without the tracker fighting you**, **see
engine hint arrows**, and **tune the engine**. It is almost entirely a frontend milestone built on
the existing single working board; the server gets two small, surgical changes. No new modules, no
new dependencies, **no new protocol commands** — `set_fen`, `set_auto`, and `set_options` already
exist and are reused.

This is the first of three M5 sub-projects. The headline M5 deliverable (cross-platform
executables) is M5c; region select is M5b. Both are out of scope here.

## 2. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Edit interaction | **Palette + place** (pick a piece, click squares to drop it); **right-click any square = clear**, regardless of the selected tool |
| Edit architecture | **Frontend scratch, commit on Done.** Pieces are placed on the local chessground board with no server traffic; "Done" sends one `set_fen`. The server is unchanged for editing. |
| Live/working fork | **Hard pause.** A board-mutating user action disables Auto-tracking so the tracker cannot overwrite the user. Re-enable Auto to re-detect the screen and resume. (The richer "detached + sync nudge" two-board model from the parent design §7 was considered via an interactive prototype and rejected in favor of this simpler behavior.) |
| Arrows | Draw the engine's best move **and** every multi-PV line (lower lines faded), with an on/off toggle. |
| Display | Show/hide toggles for the eval bar and the arrows. |
| Engine settings | **Threads** + **Hash** number inputs, wired to the existing `set_options`. |
| Deferred | Move list with per-move quality dots. |

Interactive prototypes used to settle the first two decisions are saved under
`.superpowers/brainstorm/` (`edit-mode-prototypes.html`, `fork-sync-prototypes.html`).

## 3. Architecture

M5a touches the existing layers; it adds no new ones.

- **Server (`chessmenthol/server/orchestrator.py`)** — two small changes (§4). Everything else
  (arrows, toggles, palette editing) needs nothing server-side.
- **Frontend (`frontend/src/`)** — the bulk of the work: edit mode, arrows, display toggles, engine
  settings inputs, and the hard-pause wiring on the client side for entering edit mode.

The single working board (`Orchestrator._board`) is retained. The hard-pause rule — not a second
board — is what stops the tracker and the user from fighting.

## 4. Server changes (small)

### 4.1 Hard-pause gate
In `Orchestrator.handle`, **before** acquiring `self._lock`, if the command is board-mutating
(`set_fen`, `make_move`, `undo`) and `self._tracking` is true, call `self._set_auto(False)` first,
then fall through to execute the command.

`_set_auto(False)` stops the tracking loop *outside* the lock — this is the same ordering the
existing vision commands use to avoid the `_on_tracked` re-entrant-lock deadlock (vision commands
branch before the lock; `_on_tracked` self-acquires it). Pausing before the lock preserves that
invariant.

- **Gated (pause Auto):** `set_fen`, `make_move`, `undo`.
- **Not gated:** `set_turn` (side-to-move correction — the tracker compares placement only and never
  conflicts), `set_engine`, `set_options`, `stop`.
- Entering edit mode is a frontend state with no command of its own, so the **client** sends
  `{type:"set_auto", on:false}` the instant edit mode is entered, freezing the board before the
  first placement. The server gate then also covers the eventual `set_fen` commit.

### 4.2 Persist engine settings
`set_options` currently configures `Threads`/`Hash` on the live engine but does not remember them, so
an **engine switch** reverts to the spec defaults. Store `_threads`/`_hash` on the orchestrator and
re-apply them in `_restart` after the engine is (re)selected (i.e. on `set_engine`). Depth and
multipv are already stored; this brings Threads/Hash to parity. (Re-applying the user's options after
a deeper *EngineManager-internal crash-restart* is a later refinement — out of scope for M5a.)

No state-frame additions are required: like the existing Lines/Depth inputs, the Threads/Hash inputs
are write-only from the client.

## 5. Frontend components

### 5.1 `Board.svelte` (extended)
- **Arrows.** New props `lines: LineDto[]`, `showArrows: boolean`. Compute chessground `autoShapes`
  from each line's `pv[0]` (UCI `e2e4` → `{orig:'e2', dest:'e4'}`). The best move (line 1) uses a
  strong brush; lower lines use a faded brush. Applied via the board's `drawable.autoShapes`.
  Suppressed when `!showArrows` or while editing. Requires `drawable: { enabled, visible }` in the
  chessground config.
- **Edit.** New props `editing: boolean`, `selectedEditPiece` (a piece token or `'trash'`). On
  square-select while editing, place the selected piece (or clear if trash) via `cg.setPieces`.
  Right-click clears the square under the cursor (use chessground's key-at-DOM-position helper — the
  one fiddly detail, resolved at plan time). Existing free-drag still works for rearranging.

### 5.2 `EditPalette.svelte` (new, small)
12 piece buttons + a trash button; clicking selects the active edit tool. Rendered only while
editing (below the board). Emits the selection up to `App.svelte`.

### 5.3 `Controls.svelte` (extended)
- **Position section:** an **Edit / Done** toggle button.
- **Engine section:** **Threads** and **Hash** number inputs → `set_options({threads, hash})`,
  mirroring the existing Lines/Depth input pattern.
- **Display section:** **Arrows** and **Eval bar** show/hide toggles (frontend-local booleans).

### 5.4 `App.svelte` (wiring)
Owns `editing`, `selectedEditPiece`, `showArrows` (default true), `showEvalBar` (default true).
- Passes `lines`, `showArrows`, `editing`, `selectedEditPiece` to `Board`; conditionally renders
  `EvalBar`; renders `EditPalette` while editing.
- **Enter edit:** send `{type:"set_auto", on:false}`, set `editing=true`.
- **Done:** read the board placement from chessground, `buildFen(placement, sideToMove)`, send
  `{type:"set_fen", fen}`, set `editing=false`. On a server `error` frame for that commit, **remain
  in edit mode** and surface the message.

### 5.5 `lib/edit.ts` (new, pure)
`buildFen(placement: string, sideToMove: 'white'|'black'): string` — assembles a full FEN from a
placement field: side-to-move from the argument, castling rights inferred from king/rook home
squares (white king on e1 → `K` if the h1 rook is present, `Q` if the a1 rook is present; mirror on e8/h8/a8 for black), en-passant `-`,
counters `0 1`. Pure and unit-testable. Also exposes a `kingCountOk(placement)` guard (exactly one
white and one black king) used to pre-validate before Done.

## 6. Data flow

- **Edit:** Edit click → `set_auto:false` + palette shown → place/remove pieces locally (no server
  traffic) → Done → `buildFen` → `set_fen` → server validates → analyze (legal) or `error` (stay in
  edit mode).
- **Variation:** drag move → `make_move`; the server gate auto-disables Auto if it was tracking.
- **Arrows:** each `state` frame's `lines` → recompute `autoShapes` → chessground redraws; the
  Display toggle hides/shows them.
- **Settings:** Threads/Hash input change → `set_options` → server stores and configures the engine.

## 7. Error handling

- **Illegal commit:** the frontend pre-checks king count (`kingCountOk`) before allowing Done; the
  server's existing `_apply_fen` is the final authority and emits an `error` for anything still
  invalid. On that error the user stays in edit mode to fix it — they are never silently dropped out
  with a discarded edit.
- **Transient illegal states** (two kings mid-swap, empty board while clearing) live only on the
  local chessground board and never reach the server or the engine.
- **Pause races:** the hard-pause gate stops the loop before the lock, preserving the existing
  no-deadlock ordering; a redundant pause (client `set_auto:false` then a gated command) is harmless.

## 8. Testing strategy (TDD)

- **Pure unit (`lib/edit.ts`):** `buildFen` castling inference — all home → `KQkq`; king moved →
  none; one rook moved → partial; black to move flips the side field. `kingCountOk` accepts exactly
  one king each, rejects zero/two.
- **Component:** arrow count and best-vs-rest brush derived from `lines`; arrows hidden when
  `showArrows` is false or while editing; palette selection drives placement; right-click clears;
  Done emits the expected FEN; eval-bar and arrows toggles; Threads/Hash inputs emit `set_options`.
- **Server:** the hard-pause gate stops the loop then applies the command when tracking is on, and
  leaves tracking untouched for `set_turn`; no deadlock against a fake tracker/loop; `set_options`
  persists Threads/Hash and re-applies them after a restart / engine switch (assert
  `engine.configure` is called with the stored values).
- Reuse the existing server/vision fakes and frontend test setup.

## 9. Out of scope (later milestones / passes)

- Move list with per-move quality dots.
- The two-board live/working model + "new position detected — Sync?" nudge (superseded here by hard
  pause).
- Region select (M5b).
- PyInstaller packaging → win/linux/macos executables (M5c).
