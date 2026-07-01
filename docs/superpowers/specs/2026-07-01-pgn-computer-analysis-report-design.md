# PGN Import + Lichess Computer-Analysis Report — Design

**Date:** 2026-07-01
**Branch:** `feat/svelte-tauri-migration` (stacked, per repo convention)
**Status:** Approved (brainstorm) — pending spec review, then plan.

## Goal

Two user-facing capabilities, both resting on chessops' PGN module (chessops is
Lichess's own chess library — `@lichess-org` — and is the same parser Lichess's
own web frontend uses, so we do not write a PGN parser from scratch):

1. **Import a PGN and run a full-game "computer analysis" report** with
   **full Lichess parity** on the numbers: per-player accuracy %, ACPL,
   inaccuracy/mistake/blunder counts, an evaluation graph, and per-move
   annotation badges. This is triggered from a **"Request computer analysis"**
   button and shown on a new dedicated **Report** screen.
2. **Live PGN box in the board editor**: the (already-present but unwired) PGN
   textarea in `EditPanel` updates on every board change to reflect the current
   setup position.

This is the follow-up explicitly deferred by
`2026-06-30-home-analysis-edit-screens-design.md` ("real PGN parsing/import …
FEN loads now; the PGN box and the 'PGN' wording stay for parity and a future
follow-up").

## Scope

- PGN import (paste in the Home box, or the editor's context): parse → base FEN
  + mainline moves → load into the orchestrator's existing linear history.
- Batch engine pass over every ply → one eval per position.
- Lichess-parity metrics: Win%, per-move accuracy, game accuracy, ACPL,
  ?!/?/?? classification counts.
- Dedicated Report screen: accuracy dials, eval graph, counts, jump-to-ply move
  list, on-board per-move annotation badges.
- Editor's live PGN box.

### Non-goals (v1)

- Multi-game picker (a PGN file with several games loads the **first** game).
- PGN variations / NAGs / comments (import **mainline** only).
- Drag-&-drop `.pgn` file import (paste only; the placeholder text stays).
- Persisting reports across app sessions.
- A UI to change the batch analysis depth (fixed default; configurable later).
- Replacing our rich badge taxonomy with Lichess's three-only set (we **keep**
  Brilliant/Great/Excellent/Good/Book/Miss — see Classification below).

## Decisions locked in brainstorm

| Decision | Choice |
| --- | --- |
| Report depth of analysis | **Full-game computer report** (not just load+navigate) |
| Metric fidelity | **Full Lichess parity** (Win%-based model, exact constants) |
| Badge taxonomy | **Keep rich set**, but switch ?!/?/?? boundaries to Lichess's win-chance drop |
| Report UI | **Dedicated Report screen** (dials + big eval graph + counts + jump-to-ply) |
| Batch architecture | **Approach A** — batch mode inside the orchestrator, reusing the single engine/session |
| Batch budget | depth **18**, **multipv 2** (keeps Great/Brilliant working) |
| Multi-game PGN | **first game only** |

## Existing machinery we reuse (do not rebuild)

- `core/chess.ts` — the sole chessops wrapper. We add a **second** sanctioned
  chessops-facing wrapper, `core/pgn.ts`.
- `Orchestrator` (`core/orchestrator.ts`) already owns a linear history:
  `_baseFen` + `_history: HistoryEntry[]` (uci, san, classification, lastMove,
  preAnalysis) + `_cursor`, with `navigate()`, per-move classify, and
  `_stateFrame()` serialization. Loading a PGN = populate that history.
- `core/classify.ts` (`classifyMove`) already labels moves; we adjust its
  ?!/?/?? decision only.
- `engine/types.ts`: `Eval { cp, mate }` is **White-POV**; `evalPov`/`evalScalar`
  exist but map mate to ±100000. Lichess parity needs a **separate** clamp-to-±1000
  path, so accuracy math does **not** reuse `evalScalar`.
- `BoardBadge`/`MoveBadge` + `glyphs.ts` already render the square-locked
  annotation badge for the current ply's classification; navigation already sets
  `_lastMove` per ply. Once the batch pass fills every ply's classification, the
  on-board badge works for every move with no new board code.
- `engineClient.ts` store + `ServerFrame` channel carry state/report to the UI.

---

## Component 1 — PGN I/O (`core/pgn.ts`, new)

`core/pgn.ts` is the **only** other module allowed to import chessops directly
(`chessops/pgn`, `chessops/san`, `chessops/variant`). Update the architecture
note in `core/chess.ts` to name both wrappers.

```ts
export interface ParsedGame {
  baseFen: string;                       // full FEN of the starting position
  moves: { uci: string; san: string }[]; // mainline, in order
  headers: Map<string, string>;          // raw PGN tags (for future use)
}

export function parseGame(text: string): ParsedGame;   // throws on invalid PGN / illegal SAN
export function makePositionPgn(fen: string): string;   // headers-only PGN for a setup position
export function looksLikePgn(text: string): boolean;    // FEN-vs-PGN sniff for the Home box
```

- **`parseGame`**: `parsePgn(text)` → take `games[0]` (first game). Get the
  start position via `startingPosition(game.headers)` (honours `[FEN]`/`[SetUp]`/
  `[Variant]`; falls back to standard start). `baseFen = makeFen(pos)` (through
  `core/chess.ts` `fenOf`). Walk the **mainline** (`game.moves` → first child
  chain / `mainline()` iterator); for each node `parseSan(runningPos, node.san)`
  → `Move`; if `undefined`, throw `invalid SAN "<san>" at move N`. Accumulate
  `{ uci: makeUci(move), san: node.san }`, advance `runningPos.play(move)`.
  Non-standard variants (`pos.rules !== 'chess'`) → throw "unsupported variant".
- **`makePositionPgn(fen)`**: build a `Game` with `defaultHeaders()`; if `fen`
  is not the standard start, set `SetUp="1"` and `FEN=fen`; empty move tree;
  `makePgn(game)`. Used by the editor box.
- **`looksLikePgn(text)`**: true when the trimmed text contains a `[Tag "..."]`
  header line or a move-number token (`/\b\d+\.\s*[A-Za-z]/`); a bare 6-field
  FEN string returns false.

## Component 2 — Win% / accuracy core (`core/accuracy.ts`, new, pure)

No chessops import. Exact Lichess constants (verified against current
`scalachess`/`lila`/`scalalib` sources — see Parity citations):

```ts
// cp clamped to ±1000, mate → signed ±1000 ceiling, White POV
export function cpFromEval(e: Eval): number;

// [-1, +1]; MULTIPLIER = -0.00368208 ; clamp to [-1,1]
export function winningChances(cp: number): number;   // NOT pre-clamped to ±1000

// [0, 100] = 50 + 50 * winningChances(clamp(cp, ±1000))
export function winPercent(cp: number): number;

// Lichess AccuracyPercent.fromWinPercents (mover POV win%, 0..100):
//   after >= before        -> 100
//   else 103.1668100711649*exp(-0.04354415386753951*(before-after)) - 3.166924740191411 + 1
//   clamp [0,100]           (note the +1 "uncertainty bonus")
export function moveAccuracy(beforeWin: number, afterWin: number): number;

// Lichess AccuracyPercent.gameAccuracy, per color:
//   allWin = [15cp-seed, ...cpsWhite].map(winPercent)
//   windowSize = clamp(floor(N/10), 2, 8)
//   windows = (windowSize-2) copies of the first window ++ allWin.sliding(windowSize)
//   weight_i = clamp(populationStdDev(win% in window_i), 0.5, 12)
//   per-move accuracy from sliding(2) win% pairs (mover POV), tagged with weight & color
//   colorAccuracy = ( weightedMean(accs, weights) + harmonicMean(accs) ) / 2
export function gameAccuracy(startWhite: boolean, cpsWhite: (number|null)[]):
  { white: number; black: number };

// Lichess AccuracyCP.mean: per-move max(0, signed drop), each eval ceiled ±1000,
//   mover POV, ACPL = round(arithmetic mean of that player's losses)
export function acpl(cpsWhite: number[], startWhite: boolean, color: 'white'|'black'): number;
```

Helpers (mirroring `scalalib` `Maths`): `weightedMean` (Σvw/Σw, null if Σw=0),
`harmonicMean` (n / Σ(1/max(1,v)) — note the `max(1,v)` guard), `populationStdDev`
(÷ n, not n−1). All pure and unit-tested against known values.

**Mate handling:** mate is **not** 100/0 — it is `winPercent(±1000)` ≈ 97.4 / 2.6.
`cpFromEval` maps `mate>0 → +1000`, `mate<0 → −1000`, else `clamp(cp, ±1000)`,
White POV. The classifier (below) uses its own mate branch with raw cp rules.

## Component 3 — Classification reconciliation (`core/classify.ts`, modified)

Keep the ordered rules for Book → Brilliant → Great → Best → Miss and the
Excellent/Good cpl bands. **Replace** the Inaccuracy/Mistake/Blunder decision
with Lichess's winning-chances drop, computed from the mover's POV:

```
prevWC = winningChances(cpFromEval(bestLineBefore.eval) * moverSign)   // pos before the move, best play
curWC  = winningChances(cpFromEval(afterBest.eval)      * moverSign)   // pos after the played move
delta  = prevWC - curWC     // drop from the mover's POV (>=0 is a loss of chances)

both evals are cp (no mate on either side):
  delta >= 0.30 -> BLUNDER ;  >= 0.20 -> MISTAKE ;  >= 0.10 -> INACCURACY ;  else fall through
mate involved (Lichess MateAdvice, mover-POV cp):
  MateCreated  (cp -> mate-against): prevCp < -999 -> INACCURACY ; < -700 -> MISTAKE ; else BLUNDER
  MateLost     (mate-for -> cp):      curCp  >  999 -> INACCURACY ; >  700 -> MISTAKE ; else BLUNDER
  MateDelayed  (mate kept, slower):   no judgement (fall through)
fall through (delta < 0.10, not a blunder/mistake/inaccuracy):
  cpl <= excellentMax -> EXCELLENT ; cpl <= goodMax -> GOOD ; else GOOD
```

- `moverSign = +1` if White to move at the position before the move, else −1
  (so both WC are the mover's own winning chances). `cpFromEval` returns White
  POV; multiply by the sign.
- `cpl`, `isBest`, `secondGap`, Brilliant/Great/Best/Miss logic are unchanged.
  With **multipv 2** in the batch, `secondGap` is available so Great still fires.
- **Deliberate divergence:** this diverges `classify.ts` from its Python-parity
  ancestor for the ?!/?/?? bands. The affected assertions in `classify.test.ts`
  are rewritten to Lichess expectations; the Brilliant/Great/Best/Miss/Book/
  Excellent/Good parity assertions stay.
- `DEFAULT_THRESHOLDS` keeps `excellentMax`/`goodMax`/etc.; `inaccuracyMax`/
  `mistakeMax` are no longer consulted for the negative decision (kept only as
  the Excellent/Good fall-through ceilings; documented as such).

Because live analysis and the batch pass both call `classifyMove`, the board's
live badges and the report's counts share one source of truth.

## Component 4 — Batch analysis driver (`core/orchestrator.ts`, extended)

New commands (added to `Command` in `lib/types.ts`):
`{ type: 'analyze_game' }`, `{ type: 'cancel_analysis' }`, and a load command
`{ type: 'load_pgn'; pgn: string }`.

New orchestrator state: `_reportDepth = 18`, `_batch: BatchState | null`,
`_report: GameReport | null`.

- **`loadPgn(pgn)`**: `parseGame(pgn)` (catch → `_error`), set `_baseFen`,
  rebuild `_history` by replaying UCIs (reusing `sanOf`/`playUci`), `_cursor = 0`
  (or end), reset move state, `_restart()`. Mirrors `_applyFen` but with moves.
  The Home box routes here when `looksLikePgn(text)`, else `set_fen`.
- **`analyzeGame()`**: require `_history.length > 0`. `_session.stop()`; set
  `_batch = { i: 0, total: _history.length + 1, evals: [] }`; suspend live
  analysis. Drive the existing `AnalysisSession` position-by-position: for
  position `i` (i=0 is `_baseFen`, i=k is after move k) start the session with
  `{ depth: _reportDepth }` and multipv 2; on `onUpdate` capture the latest best
  line; on `onDone` (depth reached) record the White-POV `Eval`, advance `i`,
  emit `reportProgress { done, total }`, start the next. When all positions are
  done → compute the report (below), annotate `_history[ply].classification` /
  `.lastMove` / `.preAnalysis` for every ply (so navigation shows badges),
  emit a `report` frame + a final state frame, clear `_batch`.
- **`cancelAnalysis()`**: stop the session, clear `_batch`, re-emit state.
- **onUpdate/onDone multiplexing:** the orchestrator already owns these
  callbacks; add an early branch — when `_batch !== null`, route to batch
  handling instead of the live-analysis path.
- **Report computation** (pure, delegates to `core/accuracy.ts`): from the
  per-ply White-POV evals build `cpsWhite`; `classifyMove(before_i, uci,
  analysis_i, analysis_{i+1})` per move → classification + cpl; `gameAccuracy`
  → white/black %; `acpl` per color; counts of INACCURACY/MISTAKE/BLUNDER per
  color; per-ply Win% for the graph (`winPercent(cpFromEval(evalWhite))`, seed
  ply 0 at 15 cp → ≈51%).

## Component 5 — Report data model + wire types (`lib/types.ts`)

```ts
export interface PlyReportDto {
  ply: number;            // 1..N (0 = start, omitted from moves)
  san: string; uci: string;
  winWhite: number;       // 0..100, White POV, for the graph
  cpl: number;            // mover POV, capped
  classification: ClassificationDto | null;
}
export interface PlayerReportDto { accuracy: number; acpl: number; inaccuracy: number; mistake: number; blunder: number; }
export interface GameReportDto {
  white: PlayerReportDto; black: PlayerReportDto;
  startWin: number;       // ≈51 (15cp seed)
  plies: PlyReportDto[];
}
export interface ReportFrame { type: 'report'; report: GameReportDto }
```

- `ServerFrame` gains `ReportFrame`.
- `StateFrame` gains `reportProgress: { done: number; total: number } | null`
  (non-null while a batch runs; null otherwise).
- `Command` gains `load_pgn`, `analyze_game`, `cancel_analysis`.
- `engineClient.ts` stores `report` and `reportProgress` in the Svelte store
  alongside `state`.

## Component 6 — Report screen UI

New `Screen` value `'report'` in `App.svelte` (`'home' | 'analysis' | 'edit' |
'report'`). The board column is shared; the board follows `currentPly` and shows
the `BoardBadge` for the current move (no new board code).

- **Trigger (Analysis screen):** a **"Request computer analysis"** button (in the
  engine-header/action area). Click → `send({ type: 'analyze_game' })`. While
  `reportProgress` is non-null, the button becomes a **progress bar**
  (`done/total`) with a Cancel (`cancel_analysis`). On the `report` frame,
  `screen = 'report'`.
- **`ReportPanel.svelte`** (right panel card): header with a back-arrow
  (→ `screen = 'analysis'`); accuracy **dials** (White/Black %, SVG ring);
  a counts table (?!/?/?? + ACPL per player); the eval graph; a jump-to-ply
  **move list** (reuses SAN + inline `MoveBadge`, click → `navigate(ply)`,
  current ply highlighted); footer jump nav + "New analysis".
- **`EvalGraph.svelte`**: hand-rolled SVG (no chart lib — matches house style).
  Lichess-style white-winning-chances area: dark background, white area filled
  from the bottom up to the per-ply Win% curve, dashed 50% midline, a marker
  line + dot at `currentPly`. Click / drag along x → `navigate(nearestPly)`.
  Data = `report.plies[].winWhite` (+ `startWin`).
- **`AccuracyDial.svelte`** (or inline in ReportPanel): SVG ring, `stroke-dasharray`
  by percent, colour by band (green high → amber/red low), number in the centre.

The board's on-board annotation badge per move (the user's explicit ask) is the
existing `BoardBadge`, now populated for every ply by the batch pass.

## Component 7 — Live editor PGN box (`App.svelte` + `EditPanel`)

- `App.svelte`: reactive `$: editPgn = makePositionPgn(editFen);`. Since
  `rebuildEditFen()` already fires on every piece drop (`onBoardEdit`), side
  change, castling toggle, reset, and clear, `editFen` — and therefore the PGN —
  updates live. Pass `pgn={editPgn}` into `<EditPanel>` (the currently-unwired
  prop). The textarea stays `readonly`.
- Standard start position → plain seven-tag roster (matches the placeholder);
  any other position → roster + `[SetUp "1"]` + `[FEN "…"]`.

---

## Data flow

**Load + report:**
`Home paste` → `looksLikePgn?` → `load_pgn` → `Orchestrator.loadPgn` (parseGame →
history) → Analysis screen → **Request computer analysis** → `analyze_game` →
batch pass (per-ply engine @ depth 18, mpv 2) → `reportProgress` frames →
`GameReport` (accuracy/acpl/counts/win% via `core/accuracy.ts` + `classifyMove`)
→ `report` frame → **Report screen** (dials, graph, counts, jump-to-ply, on-board
badges as you navigate).

**Editor PGN:** any board/side/castling change → `rebuildEditFen()` → `editFen`
→ `makePositionPgn` → PGN box.

## Error handling

- Invalid PGN / illegal SAN / unsupported variant → `_error(...)` frame; the
  Home box surfaces it; no history change.
- `analyze_game` with empty history → `_error("no game to analyze")`, re-emit.
- Engine failure mid-batch → stop, clear `_batch`, `_error`, re-emit state
  (partial report discarded in v1).
- `cancel_analysis` → clean stop, back to live-analysis-capable state.
- Game already over at load (e.g. PGN ends in mate) → batch still analyses the
  legal positions; terminal positions use the synthetic terminal eval path that
  `orchestrator` already has (`_classifyTerminal`).

## Testing strategy

- **`core/accuracy.ts`** (pure): `winPercent(0)===50`; `winPercent(1000)≈97.4`,
  `winPercent(-1000)≈2.6`; `winningChances` clamp; `moveAccuracy(before,after)`
  incl. `after>=before→100` and the `+1` bonus; `gameAccuracy` window/weight/
  harmonic math on a hand-checked small game (window size boundaries at N=10,20,80);
  `acpl` capping + rounding. Cross-check a real short game's accuracy against a
  Lichess reference value.
- **`core/pgn.ts`**: parse a known PGN (incl. one with `[FEN]`/`[SetUp]`) →
  expected `baseFen` + uci list; illegal-SAN throws; multi-game takes first;
  `makePositionPgn(start)` = roster only; `makePositionPgn(customFen)` contains
  `[SetUp "1"]`+`[FEN]`; `looksLikePgn` FEN-vs-PGN cases.
- **`core/classify.ts`**: rewritten ?!/?/?? assertions at the win-chance
  boundaries (Δ=0.10/0.20/0.30) + the mate branches; retained
  Brilliant/Great/Best/Miss/Book/Excellent/Good parity assertions.
- **Orchestrator batch** (integration, `FakeSession` scripted evals):
  `load_pgn` populates history; `analyze_game` emits N `reportProgress` then a
  `report` with correct counts/accuracy/plies; `cancel_analysis` aborts cleanly;
  every `_history[ply].classification` populated post-report.
- **Components**: `ReportPanel` renders dials/counts/moves; `EvalGraph` renders
  a path + marker and calls `navigate` on click; `EditPanel` shows the piped PGN;
  `App` reactive `editPgn` updates on edit callbacks; Report screen switch on the
  `report` frame; progress→button states.

## Parity citations (source of the constants)

- Win% / winningChances / mate ceiling — scalachess `core/src/main/scala/eval.scala`
  (`WinPercent.fromCentiPawns`, `winningChances` MULTIPLIER `-0.00368208`,
  `Cp.CEILING = 1000`, `fromMate` → `ceilingWithSignum`).
- Per-move & game accuracy — lila `modules/analyse/src/main/AccuracyPercent.scala`
  (`fromWinPercents` constants `103.1668100711649`, `-0.04354415386753951`,
  `-3.166924740191411`, `+1`; `gameAccuracy` window `clamp(N/10,2,8)`, stddev
  weights `clamp(_,0.5,12)`, `(weighted+harmonic)/2`, `Cp.initial = 15`).
- ?!/?/?? thresholds — lila `modules/tree/src/main/Advice.scala`
  (`winningChanceJudgements` `.3/.2/.1` on the **[-1,+1]** scale; `MateAdvice`
  −999/−700/+999/+700 cp rules).
- ACPL — lila `modules/analyse/src/main/AccuracyCP.scala` (`diffsList` ceiled
  ±1000, `max(0,·)`, mover POV; `mean` → `round`).
- Helpers — scalalib `lila/src/main/scala/Maths.scala` (`harmonicMean` with
  `max(1,v)`, `weightedMean`, population `standardDeviation`).

## File-change summary

New: `core/pgn.ts`, `core/accuracy.ts`, `components/ReportPanel.svelte`,
`components/EvalGraph.svelte`, `components/AccuracyDial.svelte` (+ tests).
Modified: `core/classify.ts`, `core/orchestrator.ts`, `lib/types.ts`,
`lib/engineClient.ts`, `App.svelte`, `EditPanel.svelte`, `HomePanel`/start wiring,
`core/chess.ts` (wrapper-note), `classify.test.ts` (rewritten ?!/?/?? bands).
