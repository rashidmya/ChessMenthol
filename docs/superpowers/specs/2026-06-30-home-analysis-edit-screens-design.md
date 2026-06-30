# Home / Analysis / Edit screens — design

**Date:** 2026-06-30
**Branch:** feat/svelte-tauri-migration
**Status:** Approved (mockup v3)

## Problem

Today the app has a single screen: board on the left, one analysis panel on the
right. That panel carries everything — engine lines, move history, **Source**
(capture) controls, and **Position** (FEN / Edit Board / Reset) controls. The
capture and position controls clutter the analysis surface, and there is no
dedicated "start here" entry point.

We are splitting the right-hand panel into **three screens** that share the same
board on the left. Only the right column changes between them.

## Goals

1. Remove the **Source** and **Position** rows from the analysis panel.
2. Add a **Home** (start) panel shown at app launch, holding: Set Up Position,
   Explore, Capture Board, a FEN/PGN paste box, and Start Analysis.
3. Replace the three-button capture flow (Capture / Select Region / Clear) with a
   single **Capture Board** button that opens region selection → Apply → Analysis.
4. Make a richer **Edit Board** screen matching the reference (palette,
   side-to-move, flip/reset/clear, castling checkboxes, FEN line, scrollable
   full-PGN box, Load).
5. Moving a piece on the Home board auto-enters Analysis ("explore").

Non-goals (deferred): real PGN parsing/import (FEN loads now; the PGN box and the
"PGN" wording stay for parity and a future follow-up). No new backend commands
beyond what already exists.

## Screen model

A single `screen` state in `App.svelte`: `'home' | 'analysis' | 'edit'`,
starting at `'home'`. The left board column is shared across all three; the right
column renders a different panel per screen.

### Transitions

| From | Trigger | To | Side effects |
|------|---------|----|-----|
| home | **Set Up Position** | edit | enter edit mode (palette/placement) |
| home | **Explore** | analysis | `set_analysis_enabled: true` |
| home | **Start Analysis** (box has a FEN) | analysis | `set_fen` then `set_analysis_enabled: true` |
| home | **Start Analysis** (box empty) | analysis | `set_analysis_enabled: true` (= Explore) |
| home | **move a piece** on the board | analysis | `set_analysis_enabled: true`, then `make_move` |
| home | **Capture Board** (desktop) | analysis | region overlay → Apply → `set_region` + `capture_now` + `set_analysis_enabled: true` |
| edit | **← (top-left)** | home | leave edit mode; no position change |
| edit | **Load** | analysis | apply FEN (placement + turn + castling) via `set_fen`, then `set_analysis_enabled: true` |
| analysis | **↩ New (bottom)** | home | `reset` to start position, `set_analysis_enabled: false` |

**Engine-on rule:** every path *into* Analysis enables analysis (the user's
chosen "both engine on" behavior). Returning Home via **New** disables it and
resets to the standard start position (a fresh "new analysis").

> Decision flags (correct if wrong): (a) editor **Load → Analysis** (not back to
> Home); (b) **New** resets the board to startpos rather than preserving the
> current position. Both match the "Start / New" mental model.

## Right-column panels

### Home panel — `HomePanel.svelte` (new)

Stacked, generously-sized controls (mockup v3 sizing):

- `Set Up Position` button → `onSetUp()`
- `Explore` button → `onExplore()`
- `Capture Board` button → `onCapture()` — **rendered only when `hasNativeCapture()`**
  (hidden on the pure-web build, as Source controls are today)
- `<textarea>` paste box, placeholder "Paste your FEN, PGN(s), or drag & drop a
  PGN file here." — bound to a local `input` string
- `Start Analysis` primary (green) button → `onStart(input)`

Props: `hasCapture: boolean`, and the callbacks above. The component owns only the
textarea value; navigation/engine effects live in `App.svelte`.

### Edit panel — `EditPanel.svelte` (new), reusing `EditPalette.svelte`

Header: back-arrow `←` (top-left) + "Set Up Position" title. Body, top to bottom:

1. **Palette** — reuse `EditPalette.svelte` (12 pieces + trash), moved *into* the
   panel (today it sits under the board). Selecting a token sets the active
   placement piece; clicking board squares places/removes as today.
2. **Side-to-move** dropdown ("White to move" / "Black to move").
3. **Toolbar** icons next to the dropdown: flip board, reset to start position,
   clear board (empty).
4. **Castling rights** — White (O-O, O-O-O) and Black (O-O, O-O-O) checkboxes,
   initialized from the current placement (inferred), user-overridable.
5. **FEN** line (monospace input) — reflects the current placement; editable.
6. **PGN** box — scrollable `<textarea>` showing the current game's PGN / headers.
   Present for parity; **not parsed on Load yet** (deferred).
7. **Load** primary (green) button → commit.

The board stays on the left so pieces can be placed by click.

### Analysis panel (modified `App.svelte` card)

- **Remove** the Source section (`SourceControls`) and Position section
  (`PositionControls`).
- Keep: engine header, move feedback, move history, navigation.
- **Bottom** (mirrors the user's screenshot): the existing `ActionBar` nav row,
  enlarged to big buttons (`⏮ ◀ ▶ ⏭`), with a muted **`↩ New`** action beneath it
  that returns Home. (Label "New" is keep-able or renameable to "Home".)

## Component changes

**New**
- `HomePanel.svelte` — start panel.
- `EditPanel.svelte` — editor panel (embeds `EditPalette`).

**Modified**
- `App.svelte` — add `screen` state; render HomePanel / analysis card / EditPanel
  per screen; route transitions + engine-enable side effects; on-home `onMove`
  switches to analysis before forwarding `make_move`; fold the capture flow's
  "Apply" into `set_region` + `capture_now`.
- `ActionBar.svelte` — larger nav buttons; add the bottom `↩ New` action (or a
  thin `PanelFooter`/inline row in the analysis card).
- `EditPalette.svelte` — unchanged API; now mounted inside `EditPanel`.
- `lib/edit.ts` — `buildFen()` gains an **explicit castling** parameter
  `{ K, Q, k, q }` (falls back to today's inference for the initial checkbox
  state). En-passant stays `-`.

**Removed**
- `SourceControls.svelte` — capture moves to Home + the existing `RegionOverlay`
  flow in `App.svelte`. The "Select Region" / "Clear Selection" buttons disappear.
- `PositionControls.svelte` — FEN box → Home textarea; Edit Board → Home "Set Up
  Position"; Reset → editor reset / analysis "New".

No backend/`Command` changes: `set_fen`, `set_turn`, `set_region`, `capture_now`,
`request_region_shot`, `reset`, `set_analysis_enabled`, `make_move`, `navigate`
all already exist.

## Capture flow (simplified)

```
Home · Capture Board
   → send request_region_shot ; show RegionOverlay
   → user drags a region ; clicks Apply (onConfirm)
   → send set_region{…} ; send capture_now ; set_analysis_enabled true
   → screen = analysis
```

`capture_now`'s current guard (region must be set) is satisfied because we set the
region immediately before capturing. `clear_region` becomes unused by the UI.

## FEN / PGN input (Home)

`Start Analysis` reads the textarea:
- Non-empty → treat as **FEN**: `set_fen{ fen: input.trim() }`, then enter Analysis.
  (PGN detection/parsing deferred; a pasted PGN currently won't load as a game.)
- Empty → enter Analysis from the current board (equivalent to Explore).

## Theming

All three screens use the existing "Editorial Slate" tokens (cream paper, dark
ink, forest-green primary) — not the dark reference screenshots. Button sizing
follows mockup v3 (large padding, tight gaps).

## Testing

- **`lib/edit.ts`** unit tests: `buildFen` with explicit castling rights
  (all combinations, `-` when none), inference fallback unchanged.
- **Component tests**:
  - `HomePanel` — renders the 5 controls; Capture hidden when `hasCapture=false`;
    Start Analysis emits the textarea value.
  - `EditPanel` — palette selection, side-to-move + castling reflected into the
    emitted FEN, Load fires commit, back fires home.
- **`App.svelte`** screen-routing tests: each transition lands on the right screen
  and enables/disables analysis as specified; on-home board move enters analysis.
- Existing analysis-panel tests updated for the removed Source/Position sections.
- Full `vitest` + `svelte-check` + `cargo` gates stay green; manual desktop e2e
  (Tauri) for the capture→analysis path.
```
