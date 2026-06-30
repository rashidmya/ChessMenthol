# Lichess Icon Webfont Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all 23 hand-rolled UI icons (inline SVG / emoji / HTML-entity) across 10 components with Lichess's own icon webfont, rendered through a small typed `<Icon>` component.

**Architecture:** Vendor Lichess's `lichess.woff2` + its generated `licon.ts` codepoint map. Register one global `@font-face` + `[data-icon]::before` rule in `app.css`. A thin `Icon.svelte` (legacy Svelte API, matching the codebase) renders `<span class="icon" data-icon={licon[name]}>`. Each call site swaps its old glyph for `<Icon name="…" />`.

**Tech Stack:** Svelte 5 (legacy `export let` API), Vite, TypeScript, Vitest + @testing-library/svelte (jsdom). Tests live in `src/tests/*.test.ts`. Type/template check: `npm run check` (`svelte-check` + `tsc`).

**Spec:** `docs/superpowers/specs/2026-06-30-lichess-icon-font-design.md`

**Conventions for every task:**
- The codebase uses the **legacy Svelte API** (`export let`, `$:`, `on:click`). Do NOT introduce runes.
- After each edit, run `npm run check` and expect **0 errors, 0 warnings** unless a step says otherwise.
- Commit after each task. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Branch is already `feat/svelte-tauri-migration` — commit directly to it.
- The icon-replacement tasks (4–13) are mechanical view-only edits with no new logic. They are verified by `npm run check` + the existing component tests + the final full suite + a manual desktop pass — not by new per-icon unit tests. Only the `Icon` component itself gets a new unit test (Task 3, TDD).

---

### Task 1: Add the `licon` codepoint map

**Files:**
- Create: `src/lib/licon.ts`

- [ ] **Step 1: Download Lichess's generated `licon.ts` verbatim**

Run (from `frontend/`):
```bash
curl -fsSL https://raw.githubusercontent.com/lichess-org/lila/master/ui/lib/src/licon.ts -o src/lib/licon.ts
```

- [ ] **Step 2: Verify it landed correctly**

Run:
```bash
grep -c "as const" src/lib/licon.ts            # expect ~118
grep -E "Gear|JumpFirst|ChasingArrows|Hamburger|ScreenDesktop|Microscope|Pencil|Target|Disc|Trash|Back|Reload|UpTriangle|DownTriangle" src/lib/licon.ts
tail -4 src/lib/licon.ts                        # expect the Licon/LiconKey/LiconValue type exports
```
Expected: the file is the `export const licon = { … } as const;` object plus
`export type Licon`, `export type LiconKey`, `export type LiconValue`. Every glyph
name used by this plan must be present in the grep output.

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: PASS (0 errors). `licon.ts` is plain TS data — it must compile cleanly on its own.

- [ ] **Step 4: Commit**

```bash
git add src/lib/licon.ts
git commit -m "feat(icons): vendor Lichess licon codepoint map

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Vendor the font + register the global CSS

**Files:**
- Create: `src/assets/fonts/lichess.woff2` (binary)
- Modify: `src/app.css` (add `@font-face` after the existing `Chess Figurine` face; add the `[data-icon]::before` rule)

- [ ] **Step 1: Download the icon font into the repo**

Run (from `frontend/`):
```bash
curl -fsSL https://raw.githubusercontent.com/lichess-org/lila/master/public/font/lichess.woff2 -o src/assets/fonts/lichess.woff2
file src/assets/fonts/lichess.woff2     # expect: Web Open Font Format (Version 2) … length 15308
```
Expected: a valid WOFF2 (~15 KB). If `file` does not report WOFF2, stop and re-download.

- [ ] **Step 2: Register the `@font-face`** in `src/app.css`

The existing `Chess Figurine` face is at the top of the file (lines 8–12). Insert the
new face immediately after it (before the `:root{` block). Find:

```css
@font-face{
  font-family:'Chess Figurine';
  src:url('./assets/fonts/chess-figurine.woff2') format('woff2');
  font-display:block;
}
```

and add directly below it:

```css
/* Lichess UI icon webfont (vendored from lila public/font/lichess.woff2).
   Glyphs live in the Unicode Private Use Area; names → codepoints in src/lib/licon.ts.
   Rendered via the [data-icon] rule below (see Icon.svelte). font-display:block so the
   raw PUA char never flashes before the font loads. */
@font-face{
  font-family:'lichess';
  src:url('./assets/fonts/lichess.woff2') format('woff2');
  font-display:block;
}
[data-icon]::before{
  font-family:'lichess';
  content:attr(data-icon);
  line-height:1;
  font-weight:normal;
  font-style:normal;
  font-variant:normal;
  text-transform:none;
  speak:none;
  -webkit-font-smoothing:antialiased;
}
```

- [ ] **Step 3: Type/template-check**

Run: `npm run check`
Expected: PASS (CSS-only change; no errors).

- [ ] **Step 4: Commit**

```bash
git add src/assets/fonts/lichess.woff2 src/app.css
git commit -m "feat(icons): vendor lichess.woff2 + register icon-font CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create the `Icon` component (TDD)

**Files:**
- Create: `src/components/Icon.svelte`
- Test: `src/tests/Icon.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/Icon.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Icon from '../components/Icon.svelte';
import { licon } from '../lib/licon';

describe('Icon', () => {
  it('renders the licon codepoint via data-icon and is decorative by default', () => {
    const { container } = render(Icon, { props: { name: 'Gear' } });
    const span = container.querySelector('span.icon');
    expect(span).toBeTruthy();
    expect(span?.getAttribute('data-icon')).toBe(licon.Gear);
    expect(span?.getAttribute('aria-hidden')).toBe('true');
    expect(span?.getAttribute('role')).toBeNull();
  });

  it('becomes a labelled img when a label is provided', () => {
    const { container } = render(Icon, { props: { name: 'Gear', label: 'Engine settings' } });
    const span = container.querySelector('span.icon');
    expect(span?.getAttribute('role')).toBe('img');
    expect(span?.getAttribute('aria-label')).toBe('Engine settings');
    expect(span?.getAttribute('aria-hidden')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/Icon.test.ts`
Expected: FAIL — cannot resolve `../components/Icon.svelte` (file does not exist yet).

- [ ] **Step 3: Implement `Icon.svelte`**

Create `src/components/Icon.svelte`:

```svelte
<script lang="ts">
  // Renders a Lichess icon-font glyph. `name` is a key of the vendored licon map;
  // the matching PUA char is placed in data-icon and drawn by the global
  // [data-icon]::before rule in app.css. The glyph inherits the surrounding
  // font-size and currentColor.
  import { licon, type LiconKey } from '../lib/licon';

  export let name: LiconKey;
  // Provide `label` only for a standalone, meaningful icon (becomes role="img").
  // Omit it when the icon is decorative (next to a text label, or inside a button
  // that already has its own aria-label) — it is then hidden from a11y.
  export let label: string | undefined = undefined;
  // Optional one-off CSS font-size override (e.g. "19px"); usually inherited.
  export let size: string | undefined = undefined;
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/Icon.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Type/template-check**

Run: `npm run check`
Expected: PASS (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/components/Icon.svelte src/tests/Icon.test.ts
git commit -m "feat(icons): add typed <Icon> component backed by the licon font

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: ActionBar — nav arrows + New

**Files:**
- Modify: `src/components/ActionBar.svelte`

- [ ] **Step 1: Import `Icon`** — add as the first line inside `<script lang="ts">`:

```svelte
  import Icon from './Icon.svelte';
```

- [ ] **Step 2: Replace the four nav glyphs and the New glyph**

Apply these exact replacements:

| Find | Replace with |
|---|---|
| `on:click={() => onNavigate(0)}>«</button>` | `on:click={() => onNavigate(0)}><Icon name="JumpFirst" /></button>` |
| `on:click={() => onNavigate(currentPly - 1)}>‹</button>` | `on:click={() => onNavigate(currentPly - 1)}><Icon name="JumpPrev" /></button>` |
| `on:click={() => onNavigate(currentPly + 1)}>›</button>` | `on:click={() => onNavigate(currentPly + 1)}><Icon name="JumpNext" /></button>` |
| `on:click={() => onNavigate(total)}>»</button>` | `on:click={() => onNavigate(total)}><Icon name="JumpLast" /></button>` |
| `<span class="ic">↩</span>New` | `<span class="ic"><Icon name="Reload" /></span>New` |

Leave the `title=` attributes, `.navbtn`, and `.ic` CSS unchanged (they now size the glyph).

- [ ] **Step 3: Verify checks + existing test**

Run: `npm run check && npx vitest run src/tests/ActionBar.test.ts`
Expected: PASS — the test queries by `title` and the text `New`, both unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/ActionBar.svelte
git commit -m "feat(icons): use licon glyphs in ActionBar nav + New

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: BoardControls — flip button

**Files:**
- Modify: `src/components/BoardControls.svelte`

- [ ] **Step 1: Import `Icon`** — add as the first line inside `<script lang="ts">`:

```svelte
  import Icon from './Icon.svelte';
```

- [ ] **Step 2: Replace the inline flip SVG**

Find (the comment line + the `<svg>` line, lines 15–16):

```svelte
    <!-- verbatim flip SVG from MOCKUP line 264 -->
    <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M6.09 19h12l-1.3 1.29a1 1 0 0 0 1.42 1.42l3-3a1 1 0 0 0 0-1.42l-3-3a1 1 0 0 0-1.42 0a1 1 0 0 0 0 1.42l1.3 1.29h-12a1.56 1.56 0 0 1-1.59-1.53V13a1 1 0 0 0-2 0v2.47A3.56 3.56 0 0 0 6.09 19m-.3-9.29a1 1 0 1 0 1.42-1.42L5.91 7h12a1.56 1.56 0 0 1 1.59 1.53V11a1 1 0 0 0 2 0V8.53A3.56 3.56 0 0 0 17.91 5h-12l1.3-1.29a1 1 0 0 0 0-1.42a1 1 0 0 0-1.42 0l-3 3a1 1 0 0 0 0 1.42Z"></path></svg>
```

Replace with:

```svelte
    <Icon name="ChasingArrows" />
```

- [ ] **Step 3: Update the `.icobtn` CSS** (the SVG selector is now dead)

Find:
```css
  .icobtn {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--ink-3, #7d776b);
    transition: .15s;
  }
  .icobtn:hover { color: var(--green, #2f5d3a); }
  .icobtn svg { width: 19px; height: 19px; }
```

Replace with (add `font-size`, drop the `svg` rule):
```css
  .icobtn {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--ink-3, #7d776b);
    font-size: 19px;
    transition: .15s;
  }
  .icobtn:hover { color: var(--green, #2f5d3a); }
```

- [ ] **Step 4: Verify checks + existing test**

Run: `npm run check && npx vitest run src/tests/BoardControls.test.ts`
Expected: PASS — the test uses `data-testid="flip-btn"` (button unchanged) and `getByText('Black')`.

- [ ] **Step 5: Commit**

```bash
git add src/components/BoardControls.svelte
git commit -m "feat(icons): use licon ChasingArrows for the flip button

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: EditPanel — back / flip / reset / clear

**Files:**
- Modify: `src/components/EditPanel.svelte`

- [ ] **Step 1: Import `Icon`** — add below the existing imports inside `<script lang="ts">`:

```svelte
  import Icon from './Icon.svelte';
```

- [ ] **Step 2: Replace the four glyphs**

| Find | Replace with |
|---|---|
| `aria-label="Back" on:click={onBack}>←</button>` | `aria-label="Back" on:click={onBack}><Icon name="Back" /></button>` |
| `title="Flip board" on:click={onFlip}>⇄</button>` | `title="Flip board" on:click={onFlip}><Icon name="ChasingArrows" /></button>` |
| `title="Start position" on:click={onReset}>↺</button>` | `title="Start position" on:click={onReset}><Icon name="Reload" /></button>` |
| `title="Clear board" on:click={onClear}>🗑</button>` | `title="Clear board" on:click={onClear}><Icon name="Trash" /></button>` |

Leave `.back` and `.ico` CSS unchanged (they size the glyph via their `font-size`).

- [ ] **Step 3: Verify check**

Run: `npm run check`
Expected: PASS. (No dedicated EditPanel test exists; svelte-check validates the template.)

- [ ] **Step 4: Commit**

```bash
git add src/components/EditPanel.svelte
git commit -m "feat(icons): use licon glyphs in the position editor toolbar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: EditPalette — erase tool

**Files:**
- Modify: `src/components/EditPalette.svelte`

- [ ] **Step 1: Import `Icon`** — add below the piece-SVG imports inside `<script lang="ts">`:

```svelte
  import Icon from './Icon.svelte';
```

- [ ] **Step 2: Replace the erase glyph**

Find:
```svelte
    <span class="eico">🗑</span> Erase
```
Replace with:
```svelte
    <span class="eico"><Icon name="Trash" /></span> Erase
```

- [ ] **Step 3: Verify check + existing test**

Run: `npm run check && npx vitest run src/tests/EditPalette.test.ts`
Expected: PASS — the test uses `data-testid="pal-trash"` and the text stays "Erase".

- [ ] **Step 4: Commit**

```bash
git add src/components/EditPalette.svelte
git commit -m "feat(icons): use licon Trash for the eraser tool

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: EngineOptions — reset-option button

**Files:**
- Modify: `src/components/EngineOptions.svelte`

- [ ] **Step 1: Import `Icon`** — add below the existing imports inside `<script lang="ts">`:

```svelte
  import Icon from './Icon.svelte';
```

- [ ] **Step 2: Replace the reset glyph**

Find:
```svelte
          <button type="button" class="rst" aria-label={`Reset ${o.name}`} on:click={() => reset(o)}>↺</button>
```
Replace with:
```svelte
          <button type="button" class="rst" aria-label={`Reset ${o.name}`} on:click={() => reset(o)}><Icon name="Reload" /></button>
```

Leave the `.rst` CSS unchanged.

- [ ] **Step 3: Verify check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/EngineOptions.svelte
git commit -m "feat(icons): use licon Reload for option reset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: EngineHeader — gear + hamburger

**Files:**
- Modify: `src/components/EngineHeader.svelte`

- [ ] **Step 1: Import `Icon`** — add below the existing imports inside `<script lang="ts">`:

```svelte
  import Icon from './Icon.svelte';
```

- [ ] **Step 2: Replace the two entity glyphs**

| Find | Replace with |
|---|---|
| `on:click\|stopPropagation={() => (open = open === 'cog' ? null : 'cog')}`<br>`>&#9881;</button>` | …`>` + `<Icon name="Gear" /></button>` |
| `on:click\|stopPropagation={() => (open = open === 'menu' ? null : 'menu')}`<br>`>&#9776;</button>` | …`>` + `<Icon name="Hamburger" /></button>` |

Concretely, replace `>&#9881;</button>` with `><Icon name="Gear" /></button>` and
`>&#9776;</button>` with `><Icon name="Hamburger" /></button>`. The buttons keep their
`aria-label` (`"Engine settings"` / `"View options"`), so the inner icon stays decorative.
Leave the `.cog` CSS unchanged.

- [ ] **Step 3: Verify check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/EngineHeader.svelte
git commit -m "feat(icons): use licon Gear + Hamburger in the engine header

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: EngineList — radio dots + remove

**Files:**
- Modify: `src/components/EngineList.svelte`

- [ ] **Step 1: Import `Icon`** — add below the existing imports inside `<script lang="ts">`:

```svelte
  import Icon from './Icon.svelte';
```

- [ ] **Step 2: Replace the selected-radio dot**

Find:
```svelte
        <span class="dot">{eng.id === engineId ? '●' : '○'}</span>
```
Replace with:
```svelte
        <span class="dot"><Icon name={eng.id === engineId ? 'Disc' : 'DiscOutline'} /></span>
```

- [ ] **Step 3: Replace the remove glyph**

Find:
```svelte
        <button type="button" class="rm" aria-label={`Remove ${eng.name}`} on:click={() => removeEngine(eng.id)}>
          {'✕'}
        </button>
```
Replace with:
```svelte
        <button type="button" class="rm" aria-label={`Remove ${eng.name}`} on:click={() => removeEngine(eng.id)}>
          <Icon name="X" />
        </button>
```

Leave the `validating…` row (`<span class="dot">{'…'}</span>`) and all `.dot` / `.rm` CSS unchanged.

- [ ] **Step 4: Verify check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/EngineList.svelte
git commit -m "feat(icons): use licon Disc/DiscOutline + X in the engine list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Lines — collapse / expand chevrons

**Files:**
- Modify: `src/components/Lines.svelte`

- [ ] **Step 1: Import `Icon`** — add below the existing `import type` inside `<script lang="ts">`:

```svelte
  import Icon from './Icon.svelte';
```

- [ ] **Step 2: Replace the two toggle SVGs with one state-driven Icon**

Find (lines 28–29):
```svelte
        <svg class="ic-down" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M5.8 9.7L12 16l6.2-6.3c.2-.2.3-.5.3-.7s-.1-.5-.3-.7s-.4-.3-.7-.3h-11c-.3 0-.5.1-.7.3s-.3.4-.3.7s.1.5.3.7" /></svg>
        <svg class="ic-up" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M18.2 13.3L12 7l-6.2 6.3c-.2.2-.3.5-.3.7s.1.5.3.7s.4.3.7.3h11c.3 0 .5-.1.7-.3s.3-.5.3-.7s-.1-.5-.3-.7" /></svg>
```
Replace with:
```svelte
        <Icon name={open.has(l.multipv) ? 'UpTriangle' : 'DownTriangle'} />
```

- [ ] **Step 3: Remove the now-dead SVG-toggle CSS and size the button**

Find:
```css
  .lexp { display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
    border: none; background: transparent; cursor: pointer; color: #a8a193; transition: .14s; }
  .lexp:hover { color: #3d7a4c; }
  .lexp svg { width: 15px; height: 15px; display: block; }
  .lexp .ic-up { display: none; }
  .line.open .lexp .ic-down { display: none; }
  .line.open .lexp .ic-up { display: block; }
```
Replace with:
```css
  .lexp { display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
    border: none; background: transparent; cursor: pointer; color: #a8a193;
    font-size: 15px; transition: .14s; }
  .lexp:hover { color: #3d7a4c; }
```

- [ ] **Step 4: Verify check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Lines.svelte
git commit -m "feat(icons): use licon Up/DownTriangle for line expand toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: HomePanel — set up / explore / capture

**Files:**
- Modify: `src/components/HomePanel.svelte`

- [ ] **Step 1: Import `Icon`** — add as the first line inside `<script lang="ts">`:

```svelte
  import Icon from './Icon.svelte';
```

- [ ] **Step 2: Replace the three button glyphs**

| Find | Replace with |
|---|---|
| `<span class="ic">♟</span>Set Up Position` | `<span class="ic"><Icon name="Pencil" /></span>Set Up Position` |
| `<span class="ic">🧭</span>Explore` | `<span class="ic"><Icon name="Microscope" /></span>Explore` |
| `<span class="ic">📷</span>Capture Board` | `<span class="ic"><Icon name="ScreenDesktop" /></span>Capture Board` |

Leave the `.ic` CSS (`font-size: 19px`) unchanged.

- [ ] **Step 3: Verify check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/HomePanel.svelte
git commit -m "feat(icons): use licon glyphs on the Start panel buttons

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: RegionOverlay — capture-box hint

**Files:**
- Modify: `src/components/RegionOverlay.svelte`

- [ ] **Step 1: Import `Icon`** — add below the existing imports inside `<script lang="ts">`:

```svelte
  import Icon from './Icon.svelte';
```

- [ ] **Step 2: Replace the target glyph**

Find:
```svelte
    <span>◉ Drag a box over the chess board</span>
```
Replace with:
```svelte
    <span><Icon name="Target" /> Drag a box over the chess board</span>
```

- [ ] **Step 3: Verify check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/RegionOverlay.svelte
git commit -m "feat(icons): use licon Target in the capture-region hint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: NOTICE attribution + final verification gate

**Files:**
- Modify: `../NOTICE.md` (repo root: `/home/buga/Dev/ChessMenthol/NOTICE.md`)

- [ ] **Step 1: Add the icon-font attribution**

In `NOTICE.md`, find the Chess Figurine font entry:

```markdown
- **Chess Figurine font** (`frontend/src/assets/fonts/chess-figurine.woff2`) —
  GNU General Public License v2.0 or later. The figurine-notation webfont by the
  pgn4web authors (the same font Lichess ships as `lichess-chess.woff2`); it
  renders piece letters as chess glyphs in move lists. Corresponding source
  (FontForge `.sfd`): <https://github.com/lichess-org/lila/tree/master/public/font>
```

and add a new entry directly after it:

```markdown

- **Lichess icon font** (`frontend/src/assets/fonts/lichess.woff2`) — GNU Affero
  General Public License v3.0 or later. The UI icon webfont from lila, rendered via
  the `licon` name→codepoint map vendored at `frontend/src/lib/licon.ts`; it provides
  the toolbar, navigation, and control glyphs. Corresponding source (FontForge `.sfd`
  + the generated `licon.ts`): <https://github.com/lichess-org/lila/tree/master/public/font>
  and <https://github.com/lichess-org/lila/blob/master/ui/lib/src/licon.ts>
```

- [ ] **Step 2: Run the full verification gate**

Run (from `frontend/`):
```bash
npm run check && npm test
```
Expected: `npm run check` reports 0 errors/0 warnings; `npm test` (vitest run) is all green, including the new `Icon` test.

- [ ] **Step 3: Confirm no stray icon glyphs remain in scope**

Run (from `frontend/`):
```bash
grep -rnE '🗑|📷|🧭|♟|◉|↩|↺|⇄|»|«|‹|›|●|○|✕|&#9881;|&#9776;' src/components \
  | grep -v 'Header.svelte'
```
Expected: **no output** (every in-scope glyph replaced). The brand knight in
`Header.svelte` is intentionally out of scope; the `grep -v` excludes it. If any other
line prints, replace that glyph with the corresponding `<Icon>` per the spec mapping and
re-run.

- [ ] **Step 4: Commit**

```bash
git add ../NOTICE.md
git commit -m "docs(icons): attribute the vendored Lichess icon font in NOTICE

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual desktop pass (human gate)**

Run: `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`
Verify every replaced icon renders as a crisp Lichess glyph (no tofu box, no raw PUA
square) and is correctly sized/aligned: ActionBar nav + New, the flip buttons, the
editor toolbar (back/flip/reset/clear) + eraser, engine header gear + hamburger, engine
list radio dots + remove, line expand/collapse chevrons, Start-panel buttons, and the
capture-region hint. The brand knight in the header is unchanged.

---

## Self-Review

**Spec coverage:** All four architecture pieces are covered — licon map (Task 1), font + CSS (Task 2), Icon component (Task 3), 23 replacements across 10 files (Tasks 4–13), NOTICE attribution (Task 14). Every row of the spec's mapping table maps to a step. Out-of-scope items (brand knight, MoveBadge/glyphs.ts, figurine font, cburnett pieces) are never touched, and Task 14 Step 3 actively asserts the brand knight is the only remaining glyph.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows exact find/replace content.

**Type consistency:** The `Icon` prop names (`name: LiconKey`, `label`, `size`) and the `licon` import path (`../lib/licon`) are identical across Task 3 and all call sites. Glyph names used in Tasks 4–13 (`JumpFirst/Prev/Next/Last`, `Reload`, `ChasingArrows`, `Back`, `Trash`, `Gear`, `Hamburger`, `Disc`, `DiscOutline`, `X`, `UpTriangle`, `DownTriangle`, `Pencil`, `Microscope`, `ScreenDesktop`, `Target`) are all verified present by Task 1 Step 2's grep.
