# Browser extension — Plan 3: panel polish, settings & error states

**Status:** design (brainstormed 2026-07-11, visual-companion assisted)
**Branch:** `feat/browser-extension` (worktree)
**Follows:** Plan 1 (skeleton + WASM engine), Plan 2 (board sources). Precedes Plan 4
(`packages/core` extraction). This is milestone 6 ("Polish") of
`2026-07-04-browser-extension-design.md`.

## 1. Goal

Turn the side panel from a working developer scaffold into a product-quality analysis
surface. Three buckets, all approved in brainstorming:

1. **Panel UI polish** — real layout and visual hierarchy.
2. **Settings** — a small, persisted preferences surface.
3. **Error & empty states** — surface what currently fails silently.

Non-goal restated from the parent spec: no new analysis capability, no engine picker, no
multi-board support. This plan reshapes and hardens what Plans 1–2 already produce.

## 2. Scope

**In scope**

- Restructured panel: header (title + source/turn badge + settings gear), board + eval bar,
  an eval readout (score/depth/best-move) above the reused MultiPV lines, and a source-aware
  control row. The raw FEN input moves behind a toggle (it is a dev/power affordance, not the
  main flow).
- Best-move arrows on the board, gated by a setting (the reused `Board` already draws them).
- A settings surface behind the gear, persisted via `browser.storage.local`:
  - **Lines (MultiPV)** — 1–5 (default 3)
  - **Thinking time** — 2s / 5s / 10s (default 5s)
  - **Auto-analyze** — on/off (default on)
  - **Best-move arrows** — on/off (default on)
  - **Live site reading** — on/off (default on)
- Error/empty states rendered from data the panel already receives (`StateFrame.visionStatus`,
  `lastError`) plus one new content→panel signal for a broken adapter:
  - **No board detected** (capture found nothing) — retry + "paste a FEN" hint
  - **Low confidence** — show the position but flag it (uses `lowConfidence[]`)
  - **Adapter broke** on a known site — offer the vision-capture fallback
  - **Capture denied** (privileged page / no gesture) — explain, DOM path unaffected
  - **Engine unavailable** (WASM load failed) — explain; board reconstruction still works

**Out of scope (explicit)**

- Engine selection / thread count (one bundled single-threaded Stockfish).
- Raw depth-by-number control ("thinking time" is the friendlier surface).
- Board themes / colors (reuses desktop board styling; a later cosmetic).
- Multi-board / premove-highlight adapter robustness (stays a separate later item).
- Background/offscreen continuous analysis (parent-spec deferral).

## 3. Architecture

Reuse-first, matching Plans 1–2. New extension-local pieces are small and presentational;
all engine/board logic stays in `@core`.

### 3.1 New / changed modules

- **`extension/src/lib/settings.ts`** — the settings store. A Svelte `writable<Settings>`
  hydrated from `browser.storage.local` on first import and persisted on every change. Exposes
  `settings` (store), `defaults`, and a `patch(partial)` helper. Pure enough to unit-test with
  a stubbed `browser.storage.local`.
- **`extension/components/SettingsPanel.svelte`** — the gear surface: renders the five controls
  bound to the settings store. Emits nothing to the engine itself; the Panel owns wiring
  settings → commands (§3.3).
- **`extension/components/SourceBadge.svelte`** — small presentational badge: source
  (`manual | vision | chesscom | lichess`) + side-to-move. Styled markup, no `@core` icon-font
  dependency (the extension has not vendored it).
- **`extension/components/PanelState.svelte`** (or inline in `Panel.svelte`) — renders the
  error/empty state cards from a single derived "panel status" value (§4).
- **`entrypoints/sidepanel/Panel.svelte`** — restructured into header / board / eval / controls;
  toggles between the analysis view and the settings view (§3.2); wires settings and gating.

### 3.2 Settings surface: full-panel view toggle (decision)

The side panel is a narrow, tall column. Rather than an overlay/modal (z-index, scroll-lock,
cramped), the **gear toggles the whole panel body between "analysis" and "settings" views**
(a `view: 'analysis' | 'settings'` local flag; the header/gear persists, the gear becomes a
back/close affordance in settings). Simplest to build and test in a narrow column, and matches
how a phone-width surface behaves. *(Alternative considered: inline expanding section under the
controls — rejected as it pushes the board around and fights vertical space.)*

### 3.3 Wiring settings → behavior

- **Lines** → `send({ type: 'set_engine_option', name: 'MultiPV', value: String(lines) })`.
- **Thinking time** → `send({ type: 'set_options', movetime: ms })` (ms; `_movetimeMs` verbatim).
- **Best-move arrows** → prop only: `<Board showArrows={settings.arrows} … />`.
- **Auto-analyze** → gates the `set_analysis_enabled({enabled:true})` calls in `captureNow`,
  `onMessage`, and `applyPosition`. Off = the position loads (`set_fen`) but analysis waits for
  the Analyze button.
- **Live site reading** → gates `onMessage`: when off, the panel ignores incoming `position`
  messages entirely (content script still runs; its output is simply dropped). Manual FEN +
  capture remain available.

**Option-replay caveat (for the plan):** `set_engine_option` / `set_options` only reach a
*loaded* engine (`_engineStarted`). Settings applied before the first analysis must be replayed
when the engine loads — either the panel re-sends current settings right after `ensureEngine()`,
or the `engineController` applies current overrides on load (mirrors desktop `applyOptions`).
The plan picks one; both keep `app/` untouched.

### 3.4 Adapter-broke signal (minimal new contract)

Today `runContentDriver` stays silent when `readPosition()` returns `null`, so the panel cannot
distinguish "not a chess page" from "board present but unreadable". Add the smallest signal that
disambiguates:

- **`SiteAdapter.boardPresent(): boolean`** (new, optional) — a cheap container-selector check,
  independent of full parsing.
- **New message kind `{ kind: 'adapter-status', site, ok: boolean }`** in `messages.ts`.
- **`runContentDriver`**: when `readPosition()` returns `null` *and* `boardPresent()` is `true`,
  emit `adapter-status { ok: false }` once (on transition); when a read later succeeds, emit
  `adapter-status { ok: true }` before the position (clears the warning).
- **Panel**: `ok:false` → render the "can't read this board — capture instead" state with a
  Capture button; any position or `ok:true` clears it.

This is bounded to one boolean method + one message kind; deeper version-tolerant parsing stays
out of scope.

## 4. Panel status: one derived state

The panel renders exactly one primary state, derived (in priority order) from data it already
holds, so the states are mutually exclusive and testable:

1. `lastError` matches an engine-load failure → **engine-unavailable** card
2. `lastError` matches a capture failure → **capture-denied/failed** card
3. `adapter-status ok:false` (latest) → **adapter-broke → capture** card
4. `visionStatus === 'no_board'` → **no-board-detected** card (retry)
5. otherwise → **analysis view** (board + eval + lines), with a **low-confidence** ribbon when
   `visionStatus === 'low_confidence'`

Error text is categorized by matching the `ErrorFrame.message` strings the orchestrator already
emits (e.g. `engine failed to load…`, `capture failed…`); no core changes required. The plan may
optionally tighten these into a small enum if string-matching proves brittle.

## 5. Permissions & manifest

- Add **`storage`** to `wxt.config.ts` manifest permissions (settings persistence). Already
  anticipated by the parent spec §7.
- No new host permissions. `activeTab` (capture) and the chess.com/lichess matches are unchanged.

## 6. Testing strategy (TDD, Vitest + @testing-library/svelte, jsdom)

Keep the extension suite green (currently 34) and `app/` byte-for-byte untouched.

- **`settings.ts`** — defaults; hydrate from a stubbed `browser.storage.local`; `patch()`
  persists and updates the store.
- **Settings → commands** — toggling Lines/Thinking-time sends the right `set_engine_option` /
  `set_options` commands; arrows flips the `showArrows` prop; auto-analyze off suppresses the
  `set_analysis_enabled` call; live-site-reading off drops `position` messages.
- **Panel status** — each of the five states renders its expected testid/text from a crafted
  `StateFrame` / `lastError` / `adapter-status`; priority order holds when several conditions
  co-occur.
- **`runContentDriver`** — `boardPresent()===true` + null read emits `adapter-status ok:false`;
  a later successful read emits `ok:true` then the position; `boardPresent()===false` stays
  silent (regression for "not a chess page").
- **SourceBadge / layout** — badge shows the right source + turn; the FEN box is behind its
  toggle by default.
- **Manual cross-browser gate (human, still pending overall):** load unpacked in Chrome +
  Firefox; verify the new layout, settings persistence across panel reopen, arrows toggle, and
  each error state (kill the engine URL, break an adapter selector, capture a `chrome://` page).

## 7. Risks & open questions

- **Error-string matching (§4)** is coupled to the orchestrator's message wording. Mitigation:
  centralize the match in one helper; optionally propose a typed error category upstream in a
  later plan (not now — keeps `app/` untouched).
- **Option replay (§3.3)** — must verify MultiPV/movetime actually take effect when set before
  the first search. Covered by a test that sets a value pre-analysis then asserts the engine
  receives it after load.
- **`boardPresent()` false positives** — a site may keep a board container mounted between games.
  Acceptable: worst case is a spurious "capture instead" offer the user can ignore; a real
  position clears it immediately.
- **Settings storage in tests** — `browser.storage.local` must be stubbed in `vi.hoisted`
  alongside the existing `browser.runtime` stub (same hoisting gotcha as Plan 1/2).

## 8. Task order (detail belongs in the plan)

1. `settings.ts` + storage permission (store, defaults, persistence). *(foundation)*
2. `SettingsPanel.svelte` + gear/view toggle in `Panel.svelte`.
3. Wire settings → commands + gating (Lines, Thinking-time, auto-analyze, live-reading, arrows),
   incl. the option-replay fix.
4. Panel layout restructure (header, SourceBadge, eval readout, controls, FEN-behind-toggle).
5. `runContentDriver` `adapter-status` + `boardPresent()` on both adapters + message kind.
6. Panel status states (§4) rendered from the derived value.
7. Green gate: 34+ vitest, svelte-check 0/0, both browser builds; update memory. Manual gate
   stays a human follow-up.
