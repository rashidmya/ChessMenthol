# Report reuse + relocated trigger + live per-move annotation — Design

**Date:** 2026-07-01
**Branch:** `feat/svelte-tauri-migration` (stacked on the PGN-import + computer-analysis-report feature, commits `9dc0d82`..`6f0af8e`)
**Depends on:** [`2026-07-01-pgn-computer-analysis-report-design.md`](2026-07-01-pgn-computer-analysis-report-design.md) (the report feature this refines)

## Goal

Three follow-up refinements to the computer-analysis report, from user feedback:

- **A. Reuse the report on Request** — clicking "Request computer analysis" when a report already exists for the game on the board reopens the report screen instantly instead of re-running the batch.
- **B. Relocate the trigger** — move the "Request computer analysis" control out of the analysis-card body into the bottom action bar, next to **New**, as an icon+label button.
- **C. Live per-move annotation** — while stepping/jumping through a game *before* running the full batch, evaluate the position before and after the move you land on so that single move's classification badge appears, at the live-analysis depth.

## Non-goals

- No change to the batch report math, the report screen layout, or the Lichess-parity classification.
- Part C does **not** annotate the whole game up front — only the move you're currently on (badges accumulate as you pass moves). The full depth-18 batch remains the way to get every move classified at once.
- No new "tabs" UI (explicitly dropped): the report stays a screen reached via the trigger; **Back** still returns to Analysis.
- No persistence of the report across app restarts (still in-memory).

---

## Part A — Reuse the report on Request

### Current behavior
`onRequestAnalysis()` in `App.svelte` unconditionally `send({ type: 'analyze_game' })`. The report object persists in the `report` store after **Back** (`rpt` stays set), but the identity-guarded auto-switch (`rpt !== lastReport`) won't re-open it, and Request always re-runs the batch.

### New behavior
`onRequestAnalysis()` checks whether a cached report matches the game currently on the board:

```ts
function onRequestAnalysis(): void {
  if (rpt && reportMatchesGame(rpt, s)) { screen = 'report'; return; }
  send({ type: 'analyze_game' });
}
```

`reportMatchesGame(report, state)` returns true iff the report's analyzed move list equals the board's current move list:

```ts
function reportMatchesGame(r: GameReportDto, st: StateFrame | null): boolean {
  const a = r.plies.map((p) => p.uci);
  const b = (st?.moveList ?? []).map((m) => m.uci);
  return a.length === b.length && a.every((u, i) => u === b[i]);
}
```

- **Match** (same move UCIs) → reopen the report screen instantly, no engine work.
- **No match** (loaded a different PGN, played a diverging move, reset → empty move list) → run the batch as before; the existing identity-guarded reactive auto-switches to the report when the new `ReportFrame` arrives.

### Notes / edge cases
- Move-UCI comparison is stateless and requires no new plumbing. It correctly distinguishes: a different game (different UCIs), a diverged line (different UCIs from the point of divergence), and a reset (empty). Two games with identical move UCIs from the *standard* start are genuinely the same analysis, so reopening is correct.
- Base-position collision (identical move UCIs from a *different* setup FEN) is a negligible theoretical case and is not guarded. If we later want to harden it, add `baseFen` to `GameReportDto` (set in `_buildReport`) and compare it too — deferred as YAGNI.
- Navigating within the report (clicking a move / the eval graph) does not change `moveList`, so the report keeps matching.

---

## Part B — Relocate the trigger into the action bar

### Current placement
`App.svelte` renders the trigger in a `.sec`/`.bd` block in the analysis-card body: `{#if progress}` → progress bar + Cancel button; `{:else}` → `data-testid="request-analysis"` button.

### New placement
Move the whole trigger (and its progress/cancel states) into `ActionBar.svelte`'s `.acts` row, beside **New**:

- `ActionBar` gains props: `onRequestAnalysis: () => void`, `onCancelAnalysis: () => void`, `reportProgress: { done: number; total: number } | null`.
- `.acts` row markup:
  - When `reportProgress` is null: render a **Request analysis** icon+label button (`data-testid="request-analysis"`, calls `onRequestAnalysis`) next to the existing **New** button.
  - When `reportProgress` is set: render a compact **Cancel · {done}/{total}** button (calls `onCancelAnalysis`) — optionally with a thin progress bar — in place of the Request button; **New** stays.
- Icon: a chart/analysis licon glyph via the existing `<Icon>` component (e.g. `name="BarChart"` — verify the exact key exists in `src/lib/licon.ts` during implementation; fall back to `Microscope`/`Graph` if not).
- Remove the old trigger block from the `App.svelte` analysis-card body.
- `App.svelte` passes `onRequestAnalysis`, `onCancelAnalysis`, and `progress` (=`$reportProgress`) into `<ActionBar ... />` (already mounted at the analysis-card bottom).

`ActionBar` is used only in the analysis context; the new props default to a no-op / null so the component stays self-contained. The report screen (`ReportPanel`) keeps its own New/Back controls (unchanged).

---

## Part C — Live per-move annotation while navigating

### Requirement
When analysis is on and you land on a move (via Next/Prev, First/Last, the move list, or the eval graph) that isn't already classified, show that one move's classification badge — evaluating the position *before* and *after* the move at the live-analysis settings. Works for any landing (step or jump). Already-classified moves restore their badge instantly. This is independent of the full batch.

### Existing machinery to reuse
- `_pending = [boardBefore, uci, beforeA, ply]` + the classify block in `_onUpdate` already classify a move once the **after** position (the one being analyzed) reaches `CLASSIFY_MIN_DEPTH` (8), *provided* `beforeA` (the pre-move eval) is present. It writes `classification`/`lastMove`/`preAnalysis` onto `_history[ply]` and clears `_pending`.
- `navigate(index)` already restores `_history[index-1].preAnalysis`/`lastMove` when present, and calls `_restart()` to analyze the current position.
- The only missing piece for a navigated-to (un-analyzed) move is `beforeA` — the eval of position `index-1`.

### New mechanism: a bounded "before" pre-pass
Add a small non-blocking state to the orchestrator:

```ts
_annotate: { boardBefore: Chess; uci: string; ply: number; latest: AnalysisInfo | null } | null = null;
```

On `navigate(index)`, after setting the cursor/board, decide:

- If `index >= 1`, analysis is enabled, and `_history[index-1].classification` is **not** already set, and the current position (`index`) is **not** terminal:
  1. Compute `boardBefore = position at index-1`, `uci = _history[index-1].move`, `ply = index-1`.
  2. Set `_annotate = { boardBefore, uci, ply, latest: null }` and start a search on the **before** FEN (position `index-1`) using the live settings (`_depth`/`_movetimeMs`). Do **not** display this search's lines.
  3. When the before-search reaches `CLASSIFY_MIN_DEPTH` (captured via `_onUpdate`) — or ends (via `_onSearchDone`) — finalize: `beforeA = _annotate.latest`; if `beforeA` has a usable best line, set `_pending = [boardBefore, uci, beforeA, ply]`; clear `_annotate`; `_session.stop()`; then `_restart()` to analyze the current position (`index`) for display.
  4. The existing `_onUpdate` classify block then fires when the current position reaches `CLASSIFY_MIN_DEPTH`, writing the badge onto `_history[ply]`.
- Else (already classified, or `index === 0`, or analysis disabled): behave exactly as today — restore any stored annotation and `_restart()`.

### Interception points
- `_onUpdate(info)`: order of checks becomes (1) `_batch` (existing full-batch capture), (2) `_annotate` (new: store `latest`; when `info.depth >= CLASSIFY_MIN_DEPTH`, finalize the before-pass as above; do **not** emit the before-lines as displayed analysis), (3) existing live path.
- `_onSearchDone()`: (1) `_batch` (existing), (2) `_annotate` (finalize the before-pass with `latest` as a fallback for bounded/short searches), (3) existing live path.

### Terminal-position edge
If the navigated-to position (`index`) is terminal (checkmate/stalemate) — only possible at the final ply — the "after" eval is synthesized rather than engine-analyzed. Reuse the existing `_classifyTerminal(boardBefore, uci, beforeA, ply)` path: run the **before** pre-pass to get `beforeA`, then classify against the synthetic terminal eval instead of `_restart()`-analyzing the terminal position.

### Consistency with existing live classify
The existing live-play classify already snapshots at `CLASSIFY_MIN_DEPTH` (it classifies once, then clears `_pending`). Part C matches that exactly for both the before and after evals, so an inline badge is computed at the same effective depth as a live-played move's badge. It may differ from the depth-18 batch badge; running the full **Request computer analysis** overwrites `_history[*].classification` with the depth-18 result, reconciling them.

### Interaction with the full batch
Part C uses `_annotate`, **not** `_batch`, so it never triggers the mid-batch command guard and never blocks navigation. During a full report batch (`_batch !== null`), navigation is already blocked by the existing guard, so the two never run concurrently.

### Rapid navigation
Each `navigate` first tears down any in-flight `_annotate`/`_pending` and stops the session before setting up the new position, so a stale before-search can't misclassify the wrong move.

---

## Enhancements (approved after initial design)

### E1 — State-aware trigger button (ties A + B together)
The relocated `ActionBar` trigger reflects three states so the reuse behavior is visible, not silent:
- `reportProgress` set → **Cancel · {done}/{total}** (calls `onCancelAnalysis`), `data-testid="analysis-progress"`.
- else a cached report matches the current game (`hasReportForGame` true) → **View game report** (calls `onRequestAnalysis`, which reopens the report screen), `data-testid="request-analysis"`.
- else → **Request computer analysis** (calls `onRequestAnalysis`, which runs the batch), `data-testid="request-analysis"`.

`App.svelte` computes `hasReportForGame = !!(rpt && reportMatchesGame(rpt, s))` and passes it (plus `reportProgress`, `onRequestAnalysis`, `onCancelAnalysis`) into `ActionBar`. The Request and View-report states share the `request-analysis` testid (same handler; only the label differs).

### E2 — Disable the trigger when no game is loaded
When `total` (= `moveList.length`) is `0`, the Request/View button is rendered `disabled` (greyed, no click), so it can't fire the orchestrator's "no game to analyze" error. Re-enables as soon as the board has ≥1 move.

### E3 — Debounce the Part-C before-pass on fast navigation
On `navigate`, the board/cursor update and the current-position analysis restart happen **immediately** (lines stay responsive). The annotation before-pass is scheduled behind a ~150 ms debounce timer; a subsequent `navigate` cancels the pending timer (and tears down any in-flight `_annotate`) before re-evaluating eligibility for the new position. This prevents rapid arrow-scrubbing from thrashing the engine with searches it would immediately cancel. (The orchestrator may use `setTimeout`/`clearTimeout` here — that restriction only applies to workflow scripts, not app code.)

### E4 — "Evaluating…" hint in the move-feedback area
While a move's classification is pending, the right-panel move-feedback area (section 3 of the analysis card) shows the pending move's SAN and an animated "Evaluating…" line instead of an empty area:

```
d3 was played
Evaluating…            ← animated (pulsing)
```

- New `annotating: boolean` field on `StateFrame`, true from the moment the current move's annotation is scheduled/in-flight until its classification is written (or the pass gives up / navigation moves away). Concretely the orchestrator sets an internal `_annotating` flag: `true` when `navigate` schedules an eligible before-pass **or** when `_playMove` sets `_pending`; `false` when the classify block writes `_history[ply].classification`, when a pass gives up (empty PV), or when navigating to an ineligible/already-classified position. This also makes live-*played* moves briefly show the same hint before their badge lands (consistent).
- During the before-pass the displayed `_lastAnalysis` (current position's lines) is **kept frozen** — the before-position's lines are captured silently and not emitted — so the lines panel doesn't flicker; only the feedback area shows the pending hint.
- `MoveFeedback.svelte` gains a prop `evaluating: { san: string } | null`. When `lastMove` is present it renders as today; else when `evaluating` is set it renders the pending row (`{san} was played` + animated `Evaluating…`); else nothing.
- `App.svelte` shows the feedback section when `viewPrefs.feedback && analysisEnabled && (s?.lastMove || s?.annotating)`, and passes `evaluating={s?.annotating && (s?.currentPly ?? 0) >= 1 ? { san: s.moveList[s.currentPly - 1]?.san ?? '' } : null}`.

## Components touched

- `src/App.svelte` — Part A (`onRequestAnalysis` reuse + `reportMatchesGame`), Part B (remove in-body trigger, pass trigger props to `ActionBar`), E1 (`hasReportForGame`), E4 (feedback-section condition + `evaluating` prop).
- `src/components/ActionBar.svelte` — Part B + E1 + E2 (Request/View/Cancel/progress in the `.acts` row, new props, icon, disabled-when-empty).
- `src/components/MoveFeedback.svelte` — E4 (`evaluating` prop + pending row with animated "Evaluating…").
- `src/core/orchestrator.ts` — Part C (`_annotate` state, `navigate` before-pass, `_onUpdate`/`_onSearchDone` interception, terminal edge), E3 (debounce timer), E4 (`_annotating` flag emitted on the state frame).
- `src/lib/types.ts` — E4 (`annotating: boolean` on `StateFrame`).
- `src/lib/licon.ts` — Part B (only if the chosen chart glyph key isn't already present).

## Testing

- **A (App):** with a `report` store matching `s.moveList`, clicking Request sets `screen='report'` and does **not** `send('analyze_game')` (spy). With a non-matching report (or none), Request sends `analyze_game`.
- **B (ActionBar):** renders the `request-analysis` button; clicking calls `onRequestAnalysis`; when `reportProgress` is set, renders the Cancel affordance calling `onCancelAnalysis`. App test confirms the trigger now lives in the action bar (still reachable via `data-testid="request-analysis"`).
- **C (orchestrator):** using a scripted session (per-FEN eval, like `orchestratorReport`'s `scriptedFactory`), load a PGN with analysis enabled, `navigate` to a ply, drain microtasks, and assert `_history[ply-1].classification` (and the emitted `moveList[ply-1].classification`) becomes non-null. Cover: a jump (not just Next), an already-classified move short-circuiting the pre-pass, `index=0` doing nothing, and analysis-disabled doing nothing. A terminal final-ply case asserts the move still classifies via the synthetic eval.
- **E1/E2 (ActionBar):** renders **Request computer analysis** by default; when `hasReportForGame` is true renders **View game report** (same `request-analysis` testid, calls `onRequestAnalysis`); when `reportProgress` is set renders **Cancel · done/total** (`analysis-progress`, calls `onCancelAnalysis`); when `total===0` the Request/View button is `disabled`.
- **E4 (MoveFeedback + orchestrator):** MoveFeedback renders the pending row (`{san} was played` + `Evaluating…`) when `lastMove` is null and `evaluating` is set, and the normal feedback when `lastMove` is present. Orchestrator: `navigate` to an un-annotated ply sets `annotating: true` on the emitted state frame; after the scripted classify completes, a subsequent frame has `annotating: false`.
- **E3 (debounce):** covered implicitly by the Part-C tests still passing (the before-pass fires after the debounce). A focused timer test is optional; if added, use fake timers to assert the before-pass search only starts after the debounce and that a second `navigate` before it fires cancels the first.

## Error handling

- Before-pass with no usable best line (empty PV): skip setting `_pending` (no classification), fall through to normal current-position analysis — mirrors the existing empty-PV guards in `_onUpdate`/`_classifyTerminal`.
- Report-reuse comparison on a null/empty state: `reportMatchesGame` treats missing `moveList` as `[]`, so an empty board never matches a non-empty report.
