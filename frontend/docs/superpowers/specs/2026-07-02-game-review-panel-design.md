# Game Review — chess.com-style summary panel + Review screen — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorm)
**Branch:** feat/svelte-tauri-migration

## Goal

Turn the post–computer-analysis experience into a chess.com-style **Game Review**:

1. A **Game Report summary** screen (reached from "Computer analysis") showing, per player, an **accuracy** number and a count for each of the **10 move classifications** we already compute, with a header whose right-side icon returns to Analysis and a big **Start Review** button.
2. A **Review** screen (reached from **Start Review**) for stepping through the analyzed game: the board, an **eval graph** in the top panel, a **two-column move list with per-move badges** (click any move to jump), the per-move feedback card, and a nav stepper with a centered **play/pause auto-play** button. A **Back** button returns to the summary.

Explicitly **out of scope** (dropped during brainstorm): Game Rating, Opening/Middlegame/Endgame phase verdicts.

## Background — what already exists (do not rebuild)

- **Full 10-class taxonomy** — `src/core/classify.ts` `MoveClass` = `brilliant, great, best, excellent, good, book, inaccuracy, mistake, blunder, miss`. Every ply's classification (label + cpl + isBest) is already computed by the analysis batch. The hard categories are done: Brilliant (sound sacrifice), Great (only-move), Miss (threw a win).
- **Report model** — `src/lib/types.ts`:
  - `ClassificationDto { label: string; cpl: number; isBest: boolean }`
  - `PlyReportDto { ply; san; uci; winWhite; cpl; classification: ClassificationDto | null }`
  - `PlayerReportDto { accuracy; acpl; inaccuracy; mistake; blunder }` ← only 3 of 10 counts today
  - `GameReportDto { white: PlayerReportDto; black: PlayerReportDto; startWin; plies: PlyReportDto[] }`
- **Report build** — `orchestrator.ts` `_buildReport` (~line 890) tallies only `inaccuracy/mistake/blunder` per side (`counts.white.{i,m,b}`), computes `accuracy`/`acpl` per side, and emits per-ply `winWhite` (the eval-graph series).
- **Report UI** — `ReportPanel.svelte` (props `report, moveList, currentPly, onNavigate, onBack, onNew`) currently shows the graph + accuracy + i/m/b counts on the `report` screen. `EvalGraph.svelte` (props `wins, currentPly, onNavigate`) renders the win% curve with click-to-jump. `AccuracyDial.svelte` exists.
- **Badges** — `BoardBadge.svelte` already maps a classification → glyph + color; `MoveHistory.svelte`, `MoveFeedback.svelte`, `ReportPanel.svelte` also render classifications.
- **Screens & nav** — `App.svelte` `Screen = 'home' | 'analysis' | 'edit' | 'report'`; `onReportBack()` → analysis; auto-switch to `report` when a new report arrives. The nav stepper (first/prev/next/last) lives in `ActionBar.svelte`. Navigation is a command: `{ type: 'navigate', index }`; best-move playback is `{ type: 'play_best', uci }`. `MoveFeedback` props: `lastMove, evaluating, onPlayBest, gameOver`.
- **Icons** — licon webfont via `Icon.svelte` + `src/lib/licon.ts`. Already present: `PlayTriangle`, `Pause`, `Search`, `Microscope`, `Star`, `StarOutline`, `ThumbsUp`, `Checkmark`, `Book`, `X`, `Trophy`, `LineGraph`, `BarChart`, `JumpFirst/Prev/Next/Last`.
- **PGN headers** — `pgn.ts` returns `headers: Map<string,string>` (includes `White`/`Black` tags when present); these are **not** currently threaded into the report.

## Architecture

Three areas over the existing report code.

### A. Data model — expand per-player counts + player names

- **`PlayerReportDto`** gains the 7 missing category counts:
  ```ts
  export interface PlayerReportDto {
    accuracy: number; acpl: number;
    brilliant: number; great: number; best: number; excellent: number; good: number;
    book: number; inaccuracy: number; mistake: number; blunder: number;
  }
  ```
- **`GameReportDto`** gains optional player names:
  ```ts
  whiteName?: string; blackName?: string;   // from PGN White/Black headers; else undefined
  ```
- **`_buildReport`** replaces the 3-field `counts` accumulator with a full per-side tally keyed by `MoveClass`. For each ply, attribute its `classification.label` to white (odd ply) or black (even ply) and increment that class's counter. Populate all 10 fields of each `PlayerReportDto`. Populate `whiteName`/`blackName` from the stored PGN headers when the game was loaded from PGN (the orchestrator must retain `White`/`Black` header values at `loadPgn` time; otherwise leave undefined).
- Serialization (`serialize.ts`) already forwards the report; extend any explicit field lists to carry the new counts + names.
- **Known limitation:** the report batch does not feed an opening book into classification, so `MoveClass.BOOK` never fires → the **Book count reads 0**. The Book row is still shown (screenshot-faithful). Wiring `book.ts` into `_buildReport` is an **optional follow-up**, not part of this feature.

### B. Game Report summary screen

- New **`GameReportSummary.svelte`** replaces `ReportPanel` as the `report`-screen body. Props: `report: GameReportDto`, `onStartReview: () => void`, `onBackToAnalysis: () => void`, `onNew: () => void`.
- Layout (matches the reference screenshot):
  - **Header:** a rosette/medal icon (`Trophy` or a star-in-disc) + centered title **"Game Review"**; a **right-side analysis icon** (`Microscope` or `Search`, `data-testid="report-to-analysis"`) that calls `onBackToAnalysis` → Analysis. **No separate back button** (removes today's `report-back`).
  - **Players row:** two columns — a generic avatar (white/black king or pawn glyph in a disc), the player name (`whiteName`/`blackName` or fallback **"White"/"Black"**), and the **accuracy** number in a boxed chip per side.
  - **Category table:** one row per class in fixed order `brilliant, great, best, excellent, good, book, inaccuracy, mistake, blunder, miss` — `white count │ badge icon + label │ black count`, colored per class (see palette). **All 10 rows always shown.**
  - **Buttons:** a secondary **New** button and a full-width primary **Start Review** button (calls `onStartReview`).
- The eval graph and accuracy dial are **not** on this screen (moved / dropped).

### C. Review screen

- `Screen` union gains **`'review'`**. `App.svelte`:
  - `onStartReview()` → `navigate(0)` (start of game) then `screen = 'review'`.
  - `onReviewBack()` → `screen = 'report'`.
  - `onBackToAnalysis()` → `screen = 'analysis'`.
- **Layout (good UX; follow existing patterns):**
  - **Header:** **‹ Back** button (`data-testid="review-back"`) → summary, + "Game Review" title.
  - **Top panel:** the **`EvalGraph`** (moved here) spanning the width, with the current-move marker and click-to-jump (reuses `wins`/`currentPly`/`onNavigate`).
  - **Main:** shared **board** + eval bar on one side; **`MoveList`** on the other.
  - Per-move **feedback card** (reuse `MoveFeedback` — classification, best line, Play-best).
  - **Bottom:** the nav stepper with a centered **play/pause** button.
- **`MoveList.svelte`** (new). Props: `moveList: MoveEntryDto[]`, `currentPly: number`, `onNavigate: (ply) => void`. Two-column White/Black rows, each move rendered with its **`MoveBadge`**; the current ply is highlighted; clicking a move calls `onNavigate(ply)`. Scrollable; auto-scrolls the current move into view.
- **`MoveStepper.svelte`** (extracted from `ActionBar`). Renders first/prev/next/last; accepts an optional **centered play/pause** control (shown only in Review). `ActionBar` reuses `MoveStepper` for its own nav row so behavior stays identical on the analysis screen.
- **Auto-play** (client-side, in `App.svelte` or the review wiring): a `playing` flag + an interval (~1200 ms) that calls `onNavigate(currentPly + 1)`. Stops at the last ply, on any manual navigation, on leaving the review screen, and on pause. The stepper's middle button shows **`PlayTriangle`** when paused and **`Pause`** while playing, toggling `playing`.

### Badge palette (MoveClass → glyph + color)

| Class | Glyph | Color |
|---|---|---|
| brilliant | `‼` (text) | teal `#26c2a3` |
| great | `❗` (text) | blue `#4a90d9` |
| best | `Star` | green `#3aa557` |
| excellent | `ThumbsUp` | green `#5a9b40` |
| good | `Checkmark` | green `#3aa557` |
| book | `Book` | brown `#a1744a` |
| inaccuracy | `?!` (text) | yellow `#e6a817` |
| mistake | `?` (text) | orange `#e07a2c` |
| blunder | `??` (text) | red `#d8452e` |
| miss | `X` | red `#d8452e` |

- Consolidate this mapping in one place — extend/reuse `BoardBadge.svelte` or extract a small shared **`MoveBadge.svelte`** used by the board, move list, feedback card, and summary table, so there is a single source of truth for glyph + color. Reuse the existing ?!/?/?? rendering already in `BoardBadge`.

## Data flow

Analysis → "Computer analysis" (ActionBar) → batch → auto-switch to **report** → `GameReportSummary` reads `$report` (now with 10 counts + names). **Start Review** → `navigate(0)` + `screen='review'` → Review reads `$state` (`moveList`, `currentPly`, per-ply `classification`) and `$report` (`plies[].winWhite` for the graph). Stepping / clicking a move / auto-play all go through the existing `{ type:'navigate', index }` command; the live per-move annotation before-pass (already shipped) fills in any not-yet-classified move you land on. **Back** → report. **Right analysis icon** → analysis.

## Error / edge handling

- No report yet: the `report`/`review` screens are only reachable once `$report` exists (same guard as today's `{#if screen === 'report' && rpt}`).
- Empty/short game: category counts are all 0 where appropriate; rows still render. Auto-play at the last ply is a no-op and clears `playing`.
- Non-PGN games (played/captured): `whiteName`/`blackName` undefined → show "White"/"Black".
- Auto-play must be cancelled when leaving review (screen change) and when the user manually navigates, to avoid a runaway interval.

## Testing

- **`accuracy`/report build:** unit-test the per-side 10-category tally — a crafted ply sequence with known labels produces the correct per-side counts, with correct white/black attribution by ply parity; names populated from PGN headers when present, undefined otherwise.
- **`GameReportSummary`:** renders each player's accuracy + all 10 counts from a `GameReportDto`; **Start Review** button calls `onStartReview`; the right analysis icon calls `onBackToAnalysis`; falls back to "White"/"Black" when names absent.
- **`MoveList`:** renders a badge per move; highlights the current ply; clicking a move calls `onNavigate(ply)`.
- **`MoveStepper` / auto-play:** the middle button toggles `PlayTriangle`↔`Pause` and the `playing` flag; auto-play advances the ply on the interval and stops at the last ply; manual nav / leaving review cancels it. (Use fake timers.)
- **Navigation (App):** Start Review → `review` (and navigates to ply 0); Back → `report`; report right-icon → `analysis`; the analysis-screen nav still works after the `MoveStepper` extraction.

## Files

**Modify:**
- `src/lib/types.ts` — expand `PlayerReportDto` (10 counts); add `whiteName?/blackName?` to `GameReportDto`.
- `src/core/orchestrator.ts` — `_buildReport` full per-side tally + names; retain PGN `White`/`Black` headers at `loadPgn`.
- `src/core/serialize.ts` — forward new report fields.
- `src/App.svelte` — `Screen` gains `'review'`; `onStartReview`/`onReviewBack`/`onBackToAnalysis`; render `GameReportSummary` on `report` and the Review composition on `review`; auto-play interval + cleanup; move `EvalGraph` to the review top panel.
- `src/components/ActionBar.svelte` — use the extracted `MoveStepper` for its nav row.
- `src/components/BoardBadge.svelte` — become (or feed) the shared badge mapping incl. the new classes.
- `src/lib/licon.ts` — add any missing glyph keys if a chosen icon isn't already mapped.

**Create:**
- `src/components/GameReportSummary.svelte`
- `src/components/MoveList.svelte`
- `src/components/MoveStepper.svelte`
- `src/components/MoveBadge.svelte` (if not folding into `BoardBadge`)
- Tests: `src/tests/GameReportSummary.test.ts`, `src/tests/MoveList.test.ts`, `src/tests/MoveStepper.test.ts`, plus additions to the report-build and App navigation tests.

## Self-review notes

- **Scope:** single coherent feature (data expansion + one new screen + summary reskin + shared stepper/badge). No rating, no phases.
- **Reuse:** classification, `EvalGraph`, `MoveFeedback`, the `navigate`/`play_best` commands, and the live-annotation before-pass are all reused; only aggregation + presentation + one screen + auto-play are new.
- **Single source of truth:** badge glyph/color in one component; per-player counts computed once in `_buildReport`.
- **Known-minor:** Book count is 0 until an opening book is wired into `_buildReport` (optional follow-up); player avatars are generic glyphs, not images.
