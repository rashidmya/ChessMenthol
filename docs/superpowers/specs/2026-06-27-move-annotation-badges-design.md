# Move-quality annotation badges — Design Spec

**Date:** 2026-06-27
**Status:** Approved for planning
**Scope:** Frontend icon set for the 10 existing `MoveClass` categories, rendered in two
places — the "Last move" panel and as a chess.com-style corner badge on the board's destination
square — plus a one-field server payload widening. Builds on the live single-board analysis
pipeline (M1–M4, M5a, the last-move comparison panel, all on `main`). No new milestone; a focused
UX improvement requested against the live app.

## 1. Overview

The backend already classifies every played move into a 10-way `MoveClass`
(`chessmenthol/analysis/classify.py`): `brilliant, great, best, excellent, good, book, inaccuracy,
mistake, blunder, miss`. The frontend already *shows* it in `LastMove.svelte`, but only as ad-hoc
text characters (`✓`, `✗`, `!!`) with per-label CSS colors. There is no icon artwork and nothing on
the board.

This spec adds a single **filled-disc badge icon set** (one design language for all 10 categories)
and renders it in two places:

1. **Last-move panel** — replace the ad-hoc `✓`/`✗`/`!!` text spans with the badge.
2. **Board** — overlay the badge on the **top-right corner of the played move's destination
   square** (chess.com-style, overflowing the edge), for **every** classified move.

### Why an original icon set (not lichess assets)

The user asked about pulling annotation icons "from lichess". Two findings reframed that:

- **Taxonomy mismatch.** `brilliant / great / best / excellent / good / book / inaccuracy /
  mistake / miss / blunder` is **chess.com's** game-review taxonomy. Lichess uses classical NAG
  glyphs (`??`, `?`, `?!`, `!`, `!!`, `!?`) and auto-flags only inaccuracy/mistake/blunder — it has
  no badge artwork for most of our categories.
- **Licensing vs. the executable requirement.** Lichess (lila) assets are **AGPL-3.0** (strong
  copyleft — risky to bundle into a distributed binary); chess.com's icons are **proprietary**
  (unusable). Shipping cross-platform executables is a hard project requirement, so we draw our own.

The result: an original SVG badge set, chess.com-style visual language, zero licensing risk, no new
dependencies, no binary assets — fully PyInstaller-compatible.

## 2. Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Badge style | **Filled discs (Style A)** — solid color circle + subtle top sheen + white symbol. Boldest, reads clearly even at small sizes. (Flat-tinted and outline-ring alternatives were rejected.) |
| Symbol set | brilliant `!!`, great `!`, best ★ (star), **excellent 👍 (thumbs-up)**, good ✓ (check), book 📖 (open book), inaccuracy `?!`, mistake `?`, miss ✗ (cross), blunder `??`. |
| Two-char symbols | `!!` / `?!` / `??` sized to match the cap-height of single-char symbols (font-size 17 vs 18.5, letter-spacing −1) so the pair doesn't look smaller. |
| Board badge placement | **Top-right corner of the destination square, overflowing the edge** (chess.com convention). Origin + destination keep the usual last-move highlight. |
| Board badge size | **Medium — 46% of one square.** |
| Which moves badge the board | **All 10 categories** (most chess.com-like). Hidden only when there is no classified last move. |
| Board overlay technique | **HTML overlay layered over chessground** (absolute-positioned, pure square→corner mapping) — not a chessground `customSvg` autoShape. Gives exact corner overflow, reuses the badge component, and stays out of the arrow `autoShapes` path. |
| Colors | Centralized in `glyphs.ts`. The old per-label CSS colors in `LastMove.svelte` are **removed**. |

### Locked palette

| label | symbol | color | label | symbol | color |
|---|---|---|---|---|---|
| brilliant | `!!` | `#1aa99c` | book | 📖 | `#a98863` |
| great | `!` | `#5a87b0` | inaccuracy | `?!` | `#efbf3b` |
| best | ★ | `#7cab3e` | mistake | `?` | `#e58f2a` |
| excellent | 👍 | `#95b94a` | miss | ✗ | `#d76b3a` |
| good | ✓ | `#b0b35c` | blunder | `??` | `#f7402d` |

## 3. Architecture

The change is almost entirely frontend, plus a single widened server field. No new dependencies, no
new protocol commands, no new runtime layers.

- **Server (`chessmenthol/server/serialize.py`)** — add `"uci": move.uci()` to the `played` dict in
  `last_move_to_dict`. The played `move` is already in hand there. This is the one and only backend
  change; it gives the frontend the destination square.
- **Frontend (`frontend/src/`)** — a pure data module + a pure mapping util + one presentational
  badge component + one overlay component, wired into the existing `LastMove.svelte` panel and the
  `App.svelte` board area.

### Units

1. **`lib/glyphs.ts`** (pure data — single source of truth)
   - `type GlyphKind = 'text' | 'star' | 'thumb' | 'check' | 'cross' | 'book'`
   - `interface GlyphSpec { kind: GlyphKind; symbol: string; color: string; }`
     (`symbol` carries the text glyph for `kind === 'text'`; ignored otherwise.)
   - `const GLYPHS: Record<string, GlyphSpec>` keyed by `MoveClass` value.
   - `glyphFor(label: string): GlyphSpec` — accessor with a neutral gray-dot fallback for any
     unknown label (defensive; backend controls labels).
   - What it does: maps a classification label to its color + symbol. Depends on nothing.

2. **`components/MoveBadge.svelte`** (presentational, reused in both placements)
   - Props: `label: string`, `size: number` (px), optional `title` (accessible label, defaults to
     the capitalized label).
   - Renders the filled-disc SVG: outer `<circle>` in the spec color, a sheen overlay
     (`<circle fill="url(#sheen-N)">` with a per-instance unique radial-gradient id so multiple
     badges on one page don't collide), and the inner symbol in white — a `<text>` for `kind:'text'`
     or a drawn path (`star`/`thumb`/`check`/`cross`/`book`) from a small internal path table.
   - `viewBox="0 0 34 34"`, scaled to `size`. `role="img"`, `aria-label={title}`.
   - What it does: draws one badge for a label at a size. Depends on `glyphs.ts` only.

3. **`lib/squareCorner.ts`** (pure mapping — mirrors the existing `region.ts` pattern)
   - `squareCorner(square: string, orientation: 'white' | 'black'): { leftPct: number; topPct: number }`
     — returns the **top-right corner** of `square` (e.g. `"e5"`) as percentages of board width/height,
     accounting for orientation (file/rank flip when black is at the bottom).
   - What it does: square name → board-relative corner. Pure; unit-testable in isolation.

4. **`components/BoardBadge.svelte`** (overlay)
   - Props: `lastMove: LastMoveDto | null`, `orientation: 'white' | 'black'`.
   - Parses the destination square from `lastMove.played.uci` via `uci.slice(2, 4)` (promotion and
     castling fall out naturally — `e7e8q → e8`, `e1g1 → g1`).
   - Renders a `<MoveBadge label={lastMove.classification.label} size={…} />` positioned absolutely
     at `squareCorner(dest, orientation)` and centered on that corner via `translate(-50%, -50%)`, so
     it overflows the edge. Badge size = 46% of one square = `46% × (boardWidth / 8)`; computed from
     the overlay's own measured width so it tracks board resize.
   - Renders nothing when `lastMove` is null. `pointer-events: none` so it never blocks the board.
   - What it does: positions one badge over the board for the current last move. Depends on
     `MoveBadge` + `squareCorner.ts`.

### Wiring

- **`App.svelte`** — `.board-wrap` (which already constrains the board to `width: min(60vh, 560px)`
  and wraps `<Board>`) becomes `position: relative`. Immediately after `<Board>` we mount
  `<BoardBadge lastMove={s?.lastMove ?? null} {orientation} />` as an absolute overlay filling the
  wrap. `App.svelte` already owns both `orientation` and `s.lastMove`, so no new state or plumbing.
- **`LastMove.svelte`** — replace the three inline `✓` / `✗` / `!!` `<span class="ico">` cases with
  `<MoveBadge label={…} size={20} />`. The played row uses `classification.label`; the two "best"
  rows use `label="best"`. The text phrases ("… is best", "… is brilliant", etc.) are unchanged. The
  per-label `.ico.*` / `.label-* .ico.bad` color CSS is deleted (color now comes from `glyphs.ts`).

### Data flow

```
classify_move → last_move_to_dict (now + played.uci) → StateFrame.lastMove
   → App.svelte
        ├─ LastMove panel  → MoveBadge (played label, best label)
        └─ BoardBadge overlay → squareCorner(played.uci dest, orientation) → MoveBadge
```

The board `fen` is the position *after* the played move, so the moved piece already sits on the
destination square — the corner badge lands directly over it. Flipping orientation recomputes the
corner. Clearing the position (no classified move) sets `lastMove` null → no board badge.

## 4. Types & protocol

- `lib/types.ts`: `LastMovePvDto` gains `uci: string`. (Currently only `best` carries `uci`; now
  `played` does too. `best` already extends `LastMovePvDto & { uci: string }`, so it is unaffected.)
- No new WebSocket commands or frame types.

## 5. Error handling & edge cases

- **Unknown / missing label** → `glyphFor` returns a neutral gray-dot spec; never throws.
- **`lastMove` null** → board overlay renders nothing; panel renders nothing (existing behavior).
- **Promotion** (`e7e8q`) and **castling** (`e1g1` / `e1c1`) → `slice(2,4)` yields the correct
  landing square; the king's destination is badged for castling (chess.com convention).
- **`isBest` played move** → panel shows the single "best" row with the `best` (star) badge; board
  shows the `best` badge. The label already encodes this; no special-casing.
- **Multiple badges on one page** (panel + board, or several panel rows) → each `MoveBadge` mints a
  unique sheen gradient id, so SVG `<defs>` ids never collide.

## 6. Testing

Vitest (frontend) + pytest (server), matching existing suites.

- **`glyphs.test.ts`** — every value of the backend `MoveClass` enum has a `GLYPHS` entry (parity
  guard); spec shape (kind/symbol/color) is stable for representative labels; `glyphFor` returns the
  fallback for an unknown label.
- **`squareCorner.test.ts`** — `squareCorner` for sample squares (`a8`, `h1`, `e4`, `d5`) under both
  orientations returns the expected corner percentages (mirrors `region.test.ts`).
- **`MoveBadge.test.ts`** — renders an `<svg>`; correct fill color and symbol/path for a given
  label; exposes an accessible `aria-label`.
- **`BoardBadge.test.ts`** — given a `lastMove` + orientation, positions the badge at the expected
  square; renders nothing when `lastMove` is null.
- **`LastMove.test.ts`** (update) — assert the badge is present (by `aria-label`/role) instead of the
  old `✗`/`!!` text; keep the existing phrase assertions ("… is brilliant", "… is best").
- **`test_serialize.py`** (update) — assert `played.uci` is present and equals the played move's UCI.

## 7. Packaging impact

Pure SVG rendering plus a one-line serializer change. No new Python or JS dependencies, no binary or
font assets (symbols are inline SVG `<text>`/paths). The frontend remains a static build served by
the app. No effect on the cross-platform executable requirement or PyInstaller packaging (M5c).

## 8. Out of scope

- Animation / entrance transitions for the badge.
- Badges on engine-line PV moves or anywhere other than the played move and the panel.
- Hover tooltips beyond the accessible `aria-label`.
- Any change to classification thresholds or the `MoveClass` taxonomy itself.
