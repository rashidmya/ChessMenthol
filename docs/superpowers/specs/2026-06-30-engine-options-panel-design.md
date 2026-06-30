# Engine Management — Per-Engine UCI Options Panel — Design

> Phase 3a of engine management. Builds on the bring-your-own (BYO) engine work
> ([2026-06-30-engine-management-byo-design.md](2026-06-30-engine-management-byo-design.md)).
> Curated one-click downloads remain a separate, later phase (3b).

## 1. Goal

Let the user view and edit **any** UCI option a selected engine advertises — driven
entirely by what the engine reports in its `uci` output — replacing the fixed global
Lines/Threads/Memory controls with a generic, engine-driven options form. This makes
the app correct for arbitrary engines (e.g. an engine without MultiPV simply doesn't
show a MultiPV control) and exposes engine-specific knobs (UCI_Elo, Skill Level,
SyzygyPath, Contempt, …) that the fixed controls never could.

**Motivating bug (BYO manual e2e, 2026-06-30):** the app blindly sent
`setoption name MultiPV value 3`; Viridithas (which doesn't support MultiPV) ignored
it and showed one line, with no way for the user to see or change the engine's actual
options. This phase fixes that class of problem generically.

## 2. Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Relationship to the existing global Lines/Threads/Memory controls | **Engine-driven form replaces them.** Render controls from what the engine advertises. Search time stays an app-level `go` parameter (it is not a UCI option). |
| D2 | Which advertised options to show | **All of them, no filtering** (including Ponder, UCI_Chess960). Most faithful; the app's `go`-loop is unaffected by Ponder, and UCI_Chess960 is the user's call. |
| D3 | When an option change takes effect | **Auto stop + restart**: on change, stop the search, send the `setoption` while idle, restart — so it applies immediately and correctly. Also sent on engine load before the first search. |
| D4 | Initial values for a newly added/used engine | **Pure engine defaults.** No app-seeded values. Only values the user changes are stored. |
| D5 | When the options form is available | **Anytime, even before analysis.** The option schema is discovered up front (at add-time and/or via an isolated probe) and cached per engine, so the form renders without first enabling analysis. |

### 2.1 Behavior change implied by D4 (call-out)

"Pure engine defaults" means the **bundled Stockfish now defaults to MultiPV=1 (one
line)** until the user raises MultiPV in the options form — down from today's 3 — and
Threads/Hash start at the engine's own defaults. Once the user sets a value it persists
per engine. This intentionally changes the out-of-box experience of the default engine,
not only BYO engines.

## 3. Architecture overview

One generic pipeline replaces the three special-cased option paths (MultiPV in the
session, Threads/Hash via `configure()`):

```
engine `uci` output ──parse──▶ UciOption[] (schema, cached per engine)
                                      │
user edits a control ─────────────────┼──▶ override stored (per engine, localStorage)
                                      ▼
        on load / on change ▶ setoption name <N> value <V>   (engine idle)
```

- **Schema** = the option list the engine advertises (`option name … type …`). Cached
  per engine id; refreshed whenever the engine loads.
- **Overrides** = only the values the user has changed from the engine default. Cached
  per engine id.
- **Effective values** = engine defaults merged with overrides; what the form displays.
- **Apply** = send each override as `setoption …` while the engine is idle (on load,
  and on change via stop→setoption→restart).

`go`-parameters (Search time / depth) are **not** UCI options and stay app-controlled,
exactly as today.

## 4. New units

### 4.1 `frontend/src/engine/uciOptions.ts` — pure parser (the single parser)

```ts
export type UciOptionType = 'spin' | 'check' | 'combo' | 'string' | 'button';
export interface UciOption {
  name: string;
  type: UciOptionType;
  default?: string;        // raw default token (engine-reported); absent for button
  min?: number;            // spin only
  max?: number;            // spin only
  vars?: string[];         // combo only
}

/** Parse one `option name <N> type <t> [default <d>] [min <m>] [max <M>] [var <v>]…` line. */
export function parseOption(line: string): UciOption | null;

/** Parse many lines, skipping non-`option` lines and unparseable entries. */
export function parseOptions(lines: string[]): UciOption[];

/** UCI string for a value change. Buttons send no value. */
export function formatSetOption(name: string, value: string | number | boolean): string;
//   spin/string/combo -> `setoption name <N> value <V>`
//   check             -> `setoption name <N> value true|false`
//   button            -> `setoption name <N>`
```

Notes: option **names can contain spaces** (`UCI_LimitStrength`, `Clear Hash`), so the
parser keys on the ` type ` / ` default ` / ` min ` / ` max ` / ` var ` delimiters, not
naive whitespace splitting. This is the only place option lines are parsed (Rust returns
raw lines — see §4.3).

### 4.2 `frontend/src/lib/engineOptions.ts` — per-engine schema + overrides store

localStorage, mirroring `engineRegistry`/`viewprefs` idioms. Two namespaces keyed by
engine id.

```ts
export interface EngineOptionsState { schema: UciOption[]; overrides: Record<string, string>; }

export function getSchema(id: string): UciOption[] | null;
export function setSchema(id: string, schema: UciOption[]): void;     // cache on probe/load

export function getOverrides(id: string): Record<string, string>;     // changed-from-default only
export function setOption(id: string, name: string, value: string): void;   // store override
export function resetOption(id: string, name: string): void;          // back to engine default
export function resetAll(id: string): void;                           // clear all overrides

/** Engine defaults merged with overrides — what the form shows and what we apply. */
export function effectiveValues(id: string): Record<string, string>;

export function clear(id: string): void;   // drop schema + overrides (called on engine remove)
```

Storage keys: `chessmenthol.engineSchema` and `chessmenthol.engineOptions` (objects keyed
by engine id), or one combined object — plan's choice. Corrupt/missing → empty, never throws.

### 4.3 Rust `engine_probe` (generalizes `engine_validate`)

```rust
#[derive(serde::Serialize)]
pub struct EngineProbe { pub name: String, pub option_lines: Vec<String> }

#[tauri::command]
pub fn engine_probe(/* app, */ spec: EngineSpec) -> Result<EngineProbe, String>;
```

- Spawns an **isolated** probe process for the given `EngineSpec` (bundled sidecar **or**
  external path) — **independent of the live analysis engine (`EngineState`)**, so probing
  an engine never kills/disturbs a running search. (This is why probing does not reuse
  `engine_start`.)
- Performs the `uci` handshake; collects the `id name …` line and every raw `option …`
  line until `uciok` (or timeout); returns `{ name, option_lines }`. **Rust does not
  parse options** — it returns raw lines; the frontend parses them with `uciOptions.ts`
  (one parser, in TS).
- Replaces `engine_validate` (which only returned the name). The add flow and on-demand
  schema fetch both use it. Same timeout/handshake discipline as `engine_validate`.
- Errors (not a UCI engine, timeout, spawn failure) surface as today.

### 4.4 `frontend/src/components/EngineOptions.svelte` — the form

Renders `effectiveValues` against the cached `schema` for the **selected** engine:

| UCI type | Control | Change emits |
|---|---|---|
| spin | number input with `min`/`max` (clamped) | `set_engine_option {name, value}` |
| check | toggle | `set_engine_option {name, value: 'true'|'false'}` |
| combo | `<select>` of `vars` | `set_engine_option {name, value}` |
| string | text input | `set_engine_option {name, value}` |
| button | button | `set_engine_option {name}` (no value; fire-and-forget) |

- A changed-from-default control shows a small "reset" affordance (→ `reset_engine_option`),
  plus a per-engine **"Reset to defaults"** (→ `reset_engine_options`).
- If no schema is cached yet, the form triggers an on-demand fetch (§5) and shows a brief
  "loading options…" state; on fetch failure shows "options unavailable for this engine".
- Lives inside `EngineSettings`, replacing the removed Lines/Threads/Memory rows. **Search
  time stays.** Styled to match the existing settings rows.

## 5. Data flow

- **Add external engine:** dialog → `invoke('engine_probe', { spec: { kind:'external', path } })`
  → `{ name, option_lines }` → `registry.add({…})` + `engineOptions.setSchema(id, parseOptions(option_lines))`.
- **Open settings for the selected engine:** read cached schema; if absent (e.g. bundled,
  first run) fetch on demand —
  - Tauri: `engine_probe(spec)` for the engine's spec (isolated; does not touch the live engine).
  - Browser: capture options during a `loadStockfish` handshake.
  Cache via `setSchema`. Render the form from schema + `effectiveValues`.
- **Edit a value:** `set_engine_option {name, value}` → `engineOptions.setOption(id, …)` →
  orchestrator **stops** the search, the engine controller sends `setoption …` while idle,
  then **restarts** — change is visible immediately.
- **Engine load / switch:** after `uciok`, the controller applies that engine's overrides
  (`effectiveValues` → `setoption …`) before the first `go`. Switching engines applies the
  new engine's overrides; per-engine-id keying means no cross-contamination.
- **Loaders refresh schema:** `loadNativeEngine` / `loadStockfish` capture `option` lines
  during their handshake and `setSchema` on every load, keeping the cache accurate.
- **Remove engine:** `EngineList.removeEngine` calls `engineOptions.clear(id)` alongside
  `registry.remove(id)`.

## 6. Changes to existing code

| File | Change |
|---|---|
| `engine/session.ts` | Drop `lastMultipv` + `StartOptions.multipv`. MultiPV becomes a normal override applied on load/change. `StartOptions` keeps `depth`/`timeMs` (go-params). The info-line `multipv` parsing for the Lines display is unchanged. |
| `engine/engine.ts` | `configure(engine, {threads, hash})` → generic `applyOptions(engine, values: Record<string,string>, schema)` that emits `setoption …` per value (buttons excluded from bulk apply). |
| `engine/nativeEngine.ts` | Capture `option` lines during the handshake; cache schema on load. |
| `engine/engine.ts` `loadStockfish` | Same handshake option-capture for the wasm/bundled engine. |
| `lib/engineClient.ts` `engineController` | Apply the selected engine's `effectiveValues` on load/switch (replaces the Threads/Hash-only `configure` path). Knows the selected engine id (already does via `select`). |
| `core/orchestrator.ts` | Replace the option-bits of `setOptions` with `setEngineOption(name, value)` + `resetEngineOption`/`resetEngineOptions`; keep `movetime`/Search-time + depth handling. Stop→apply→restart on change. Read effective MultiPV from the store where the analysis/serialize path needs the current value. |
| `components/EngineSettings.svelte` | Remove the Lines/Threads/Memory rows; keep **Search time**; add `<EngineOptions {engineId} … />`. |
| `lib/options.ts` | Drop `DEFAULT_LINES`, `DEFAULT_THREADS`, `DEFAULT_MEMORY_INDEX`, `MEMORY_MB` (no longer global controls). Keep `SEARCH_TIMES`, `searchLabel`, search-time defaults. |
| `lib/types.ts` | Add commands `set_engine_option { name; value? }`, `reset_engine_option { name }`, `reset_engine_options`. Remove the now-unused `multipv`/`threads`/`hash` fields from `set_options` (keep `depth`/`movetime`). |
| `components/EngineList.svelte` | On add, `setSchema` from the probe result; on remove, `engineOptions.clear(id)`. Rename `engine_validate` call → `engine_probe`. |
| `src-tauri/src/engine.rs` + `lib.rs` | `engine_validate` → `engine_probe(spec)` returning `{ name, option_lines }`; spawn isolated per spec; register the renamed command. |

## 7. Error handling & edge cases

- **Engine lacks an option a stored override names** (shouldn't happen since overrides are
  per-engine-id and seeded from that engine's own schema): `applyOptions` only emits values
  whose names exist in the current schema; unknown names are skipped.
- **Probe/schema-fetch failure:** the form shows "options unavailable for this engine"; the
  engine still runs at its defaults (analysis unaffected).
- **spin clamping:** values clamped to `[min, max]`; non-numeric input rejected.
- **Apply while searching:** always stop→idle→`setoption`→restart (D3); never send a
  `setoption` mid-search.
- **Probe isolation:** the probe process is separate from `EngineState`; opening the options
  panel (or adding an engine) never kills a running analysis search.
- **MultiPV display coupling:** the Lines panel renders whatever `multipv` ranks appear in
  info lines; with MultiPV unset (engine default 1) it shows one line — correct and expected.

## 8. Testing

- `uciOptions.ts`: parse each type (spin/check/combo/string/button), names-with-spaces,
  defaults/min/max/var extraction, malformed/non-option lines, `formatSetOption` per type.
- `engineOptions.ts`: schema cache; override set/reset/resetAll; `effectiveValues` merge;
  `clear`; corrupt-storage fallback; per-engine-id isolation.
- `EngineOptions.svelte`: renders each control type from a schema; editing emits the right
  `set_engine_option`; reset affordances; "loading"/"unavailable" states; no schema → fetch.
- `engine_probe` (Rust): returns name + option lines for the bundled engine (skips if the
  binary is absent, like the existing validate test); errors on a non-UCI binary; isolated
  spawn doesn't touch `EngineState`.
- `orchestrator`: `set_engine_option` stores the override and restarts; load applies overrides.
- `session`: no longer special-cases MultiPV (its `setoption MultiPV` now comes from the
  generic apply path, verified by the controller/orchestrator tests).
- Migration sanity: existing analysis/lines/threads tests updated for the generic path.

## 9. Out of scope (YAGNI)

Curated one-click engine downloads (Phase 3b); option presets import/export; per-position
or per-mode options; moving Search-time/depth into the engine form (they stay app controls);
inter-option constraint validation; auto-seeding "recommended" values (explicitly rejected,
D4); a separate "advanced" grouping (all options shown flat, D2).

## 10. File structure

### Created
- `frontend/src/engine/uciOptions.ts`
- `frontend/src/lib/engineOptions.ts`
- `frontend/src/components/EngineOptions.svelte`
- `frontend/src/tests/uciOptions.test.ts`
- `frontend/src/tests/engineOptions.test.ts`
- `frontend/src/tests/EngineOptions.test.ts`

### Modified
- `frontend/src-tauri/src/engine.rs`, `lib.rs` (`engine_validate`→`engine_probe`)
- `frontend/src/engine/nativeEngine.ts`, `engine/engine.ts`, `engine/session.ts`
- `frontend/src/lib/engineClient.ts`, `lib/engineRegistry.ts` (remove hook), `lib/options.ts`, `lib/types.ts`
- `frontend/src/core/orchestrator.ts`
- `frontend/src/components/EngineSettings.svelte`, `components/EngineList.svelte`
- Tests touching the old MultiPV/Threads/Hash global path (orchestrator, EngineSettings, session, nativeEngine, EngineList).

### Gates
- `cd frontend && npx vitest run` — all green
- `cd frontend && npm run check` — 0 errors / 0 warnings
- `cd frontend/src-tauri && cargo build && cargo test` — compiles + Rust tests pass
