# Adopt Lichess's icon webfont

**Date:** 2026-06-30
**Branch:** feat/svelte-tauri-migration
**Status:** Approved (design)

## Goal

Replace every hand-rolled UI/control icon in the frontend (inline SVGs, emoji, and
HTML entities) with Lichess's icon set, rendered from Lichess's own icon webfont.
This gives true Lichess visual parity and a single typed icon abstraction, matching
the project's existing "Lichess-parity / vendored Lichess webfont" approach (we
already vendor the figurine font the same way).

## Decision

Lichess does **not** publish an installable icon package. Its "icon library" is an
in-house custom webfont — `public/font/lichess.woff2` plus a generated codepoint map
at `ui/lib/src/licon.ts` (icon names → Unicode Private Use Area chars, U+E000+),
rendered as `<span data-icon="…">` via CSS. We **vendor that font + map** into our
repo (chosen over the `lucide-svelte` fallback, which would not match Lichess's look).

## Architecture

Four pieces, mirroring how `chess-figurine.woff2` is already vendored.

### 1. Vendor the font
- Copy `lichess.woff2` from lila (`public/font/lichess.woff2`) into
  `src/assets/fonts/lichess.woff2`.
- Register it in `src/app.css`, next to the existing `Chess Figurine` `@font-face`:
  ```css
  @font-face{
    font-family:'lichess';
    src:url('./assets/fonts/lichess.woff2') format('woff2');
    font-display:block;   /* never flash the raw PUA char */
  }
  ```
- Add the render rule (also in `app.css`):
  ```css
  [data-icon]::before{ font-family:'lichess'; content:attr(data-icon); line-height:1;
    speak:none; font-style:normal; font-weight:normal; font-variant:normal;
    text-transform:none; -webkit-font-smoothing:antialiased; }
  ```

### 2. `src/lib/licon.ts`
Copy Lichess's generated file **verbatim** (the `licon` object + its
`Licon` / `LiconKey` / `LiconValue` type exports). It is small (~118 named glyphs)
and keeping the whole map exposes the full named set for future UI. This file is the
single source of truth for icon names → codepoints.

### 3. `src/components/Icon.svelte`
A thin wrapper. **Match the codebase's legacy Svelte 5 API** (`export let`, not runes —
see `EngineHeader.svelte`):

```svelte
<script lang="ts">
  import { licon, type LiconKey } from '../lib/licon';
  export let name: LiconKey;
  export let label: string | undefined = undefined; // a11y; omit for decorative
  export let size: string | undefined = undefined;   // optional CSS font-size override
</script>

<span
  class="icon"
  data-icon={licon[name]}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : true}
  style={size ? `font-size:${size}` : undefined}
></span>
```

- Decorative icons (next to a text label, or inside a button with its own
  `aria-label`) pass no `label` → `aria-hidden="true"`.
- Standalone meaningful icons pass `label` → `role="img"` + `aria-label`.
- The glyph inherits `currentColor` and the surrounding `font-size` by default;
  `size` is only for one-offs.

### 4. Replace all 23 usages
Swap each inline SVG / emoji / HTML-entity icon for `<Icon name="…" />`, delete the
old markup, and drop now-dead CSS (e.g. `.ic-down`/`.ic-up` SVG rules in `Lines.svelte`).
Buttons that currently carry an `aria-label` (e.g. EngineHeader's gear/menu) keep it on
the button; the inner `<Icon>` stays decorative.

## Icon mapping (our icon → Lichess `licon`)

| File:line | Today | → `licon` name |
|---|---|---|
| `ActionBar.svelte:10` | « first move | `JumpFirst` |
| `ActionBar.svelte:12` | ‹ previous | `JumpPrev` |
| `ActionBar.svelte:14` | › next | `JumpNext` |
| `ActionBar.svelte:16` | » last | `JumpLast` |
| `ActionBar.svelte:19` | ↩ New | `Reload` |
| `BoardControls.svelte:16` | flip board (SVG) | `ChasingArrows` |
| `EditPanel.svelte:24` | ← Back | `Back` |
| `EditPanel.svelte:36` | ⇄ flip board | `ChasingArrows` |
| `EditPanel.svelte:37` | ↺ start position | `Reload` |
| `EditPanel.svelte:38` | 🗑 clear board | `Trash` |
| `EditPalette.svelte:42` | 🗑 erase tool | `Trash` |
| `EngineOptions.svelte:100` | ↺ reset option | `Reload` |
| `EngineHeader.svelte:54` | ⚙ engine settings | `Gear` |
| `EngineHeader.svelte:61` | ☰ view menu | `Hamburger` |
| `EngineList.svelte:87` | ●/○ selected radio | `Disc` / `DiscOutline` (ternary) |
| `EngineList.svelte:93` | ✕ remove engine | `X` |
| `Lines.svelte:28` | chevron-down collapse (SVG) | `DownTriangle` |
| `Lines.svelte:29` | chevron-up expand (SVG) | `UpTriangle` |
| `RegionOverlay.svelte:63` | ◉ capture-box hint | `Target` |
| `HomePanel.svelte:13` | ♟ Set Up Position | `Pencil` |
| `HomePanel.svelte:14` | 🧭 Explore | `Microscope` |
| `HomePanel.svelte:16` | 📷 Capture Board | `ScreenDesktop` |

Line numbers are from the recon snapshot and may drift; match by intent.

## Out of scope (do not touch)

- **Header brand `♞`** (`Header.svelte:7`) — our identity, left as-is. Lichess's own
  logo glyph (`licon.Logo`) is *their* brand; we will not stamp it as ours.
- **Move-quality badges** — `src/lib/glyphs.ts` + `MoveBadge.svelte` (domain artwork).
- **Figurine notation webfont** — `chess-figurine.woff2` + `--figurine`.
- **Board piece SVGs** — `src/assets/pieces/cburnett/*`.
- Unused Vite-template assets (`svelte.svg`, `vite.svg`, `hero.png`) — optional cleanup,
  not part of this change.

## Licensing

`lichess.woff2` + `licon.ts` originate from lila (AGPL-3.0). The project already
vendors GPL-family chess assets and ships a `NOTICE` file. Add an attribution entry for
the Lichess icon font in `NOTICE`, and verify the font's distribution terms before
shipping. Not a blocker.

## Testing

- A unit test for `Icon.svelte` (Vitest + @testing-library/svelte, the project's stack):
  renders `<Icon name="Gear" />` and asserts the `data-icon` attribute equals
  `licon.Gear`; with `label`, asserts `role="img"` + `aria-label`; without `label`,
  asserts `aria-hidden="true"`.
- Existing suite (`vitest run`), `svelte-check`, and `tsc` must stay green.
- Manual desktop pass: every replaced icon renders as a Lichess glyph (no tofu / no raw
  PUA box) under `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`.

## Acceptance criteria

1. `lichess.woff2` vendored + `@font-face` and `[data-icon]::before` registered in `app.css`.
2. `src/lib/licon.ts` present (verbatim Lichess map + types).
3. `src/components/Icon.svelte` present with the API above (legacy Svelte API).
4. All 23 usages replaced per the mapping; old inline SVG/emoji/entity markup and dead
   CSS removed.
5. Brand knight and all out-of-scope items unchanged.
6. `NOTICE` updated with Lichess icon-font attribution.
7. `vitest run`, `svelte-check`, `tsc` green; Icon unit test added.
8. Manual desktop check: all icons render correctly.
