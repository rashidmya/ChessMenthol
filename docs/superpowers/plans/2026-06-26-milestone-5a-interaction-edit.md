# Milestone 5a — Interaction & Correction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ChessMenthol usable as a live assistant: correct a misdetected piece (palette edit), explore variations without the tracker fighting you (hard pause), see engine hint arrows, and tune Threads/Hash.

**Architecture:** Almost entirely frontend. The single working board is kept; a "hard pause" rule (a board-mutating user command disables Auto-tracking) replaces any two-board model. Edit mode is a frontend scratch board committed as one `set_fen`. Arrows derive from the existing `pv` (UCI) via chessground `autoShapes`. Two small server changes: the hard-pause gate and persisting Threads/Hash across an engine switch.

**Tech Stack:** Python (FastAPI orchestrator, python-chess, pytest), Svelte 5 + TypeScript + `@lichess-org/chessground` (vitest + @testing-library/svelte).

**Spec:** `docs/superpowers/specs/2026-06-26-milestone-5a-interaction-edit-design.md`

**Test commands:**
- Python (one test): `.venv/bin/pytest tests/server/test_orchestrator.py::test_name -q`
- Python (all): `.venv/bin/pytest -q`
- Frontend (one file): `cd frontend && npx vitest run src/tests/<file>.test.ts`
- Frontend (all): `cd frontend && npx vitest run`

---

## File Structure

**Server (modify):**
- `chessmenthol/server/orchestrator.py` — add the hard-pause gate in `handle`; store `_threads`/`_hash`; re-apply them in `_restart`.
- `tests/server/test_orchestrator.py` — new tests (hard pause, settings persistence).

**Frontend (create):**
- `frontend/src/lib/edit.ts` — pure: `buildFen`, `kingCountOk`, `pieceFromToken`, `coordsToKey`.
- `frontend/src/lib/arrows.ts` — pure: `linesToShapes`.
- `frontend/src/components/EditPalette.svelte` — the 12-piece + trash palette.
- `frontend/src/tests/edit.test.ts`, `frontend/src/tests/arrows.test.ts`, `frontend/src/tests/EditPalette.test.ts`.

**Frontend (modify):**
- `frontend/src/components/Board.svelte` — arrows (`setAutoShapes`) + edit (`setPieces`, right-click clear, `getPlacement`); guard `after`/`fen`-sync while editing.
- `frontend/src/components/Controls.svelte` — Edit/Done toggle, Threads/Hash inputs, Arrows/Eval-bar toggles.
- `frontend/src/App.svelte` — wiring (editing state, palette, toggles, commit-on-Done).
- `frontend/src/tests/Controls.test.ts`, `frontend/src/tests/Board.test.ts` — extended.

No protocol/`types.ts` change: `set_fen`, `set_auto`, `set_options{threads,hash}` all already exist.

---

## Task 1: Server — hard-pause gate

**Files:**
- Modify: `chessmenthol/server/orchestrator.py` (the `handle` method, ~line 55)
- Test: `tests/server/test_orchestrator.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/test_orchestrator.py` (the `FakeTracker(result)` class already defined there returns `None` from `detect_position` and a sentinel from `grab_if_changed`):

```python
def test_user_move_pauses_tracking(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    orch.handle({"type": "set_auto", "on": True})
    assert orch._tracking is True
    orch.handle({"type": "make_move", "uci": "e2e4"})
    assert orch._tracking is False
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["tracking"] is False
    assert state["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3")


def test_set_turn_does_not_pause_tracking(make_orchestrator):
    frames = []
    orch = make_orchestrator(tracker=FakeTracker(None), send=frames.append)
    orch.handle({"type": "set_auto", "on": True})
    orch.handle({"type": "set_turn", "white": False})
    assert orch._tracking is True
    state = [f for f in frames if f["type"] == "state"][-1]
    assert state["sideToMove"] == "black"
    orch.handle({"type": "set_auto", "on": False})  # stop the daemon thread
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py::test_user_move_pauses_tracking -q`
Expected: FAIL — `assert orch._tracking is False` fails (currently `make_move` leaves tracking on).

- [ ] **Step 3: Implement the gate**

In `chessmenthol/server/orchestrator.py`, add a module-level constant near the top (after `CLASSIFY_MIN_DEPTH = 8`):

```python
# Board-mutating user commands that must not be fought by the tracker. They pause
# Auto BEFORE the lock is taken (the tracking loop's _on_tracked self-acquires the
# lock, so stopping it from inside the lock would deadlock).
_PAUSE_ON_TRACKING = {"set_fen", "make_move", "undo"}
```

Then in `handle`, insert the gate immediately after the `capture_now` branch and before `with self._lock:`:

```python
        if ctype == "capture_now":
            self._capture_now()
            return
        if ctype in _PAUSE_ON_TRACKING and self._tracking:
            self._set_auto(False)
        with self._lock:
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py -q`
Expected: PASS (new tests pass; all existing orchestrator tests still pass).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/server/orchestrator.py tests/server/test_orchestrator.py
git commit -m "feat(server): pause auto-tracking on board-mutating user commands"
```

---

## Task 2: Server — persist Threads/Hash across an engine switch

**Files:**
- Modify: `chessmenthol/server/orchestrator.py` (`__init__`, `set_options`, `_restart`)
- Test: `tests/server/test_orchestrator.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/server/test_orchestrator.py`:

```python
class RecordingEngine:
    """Engine stub that records select()/configure() calls (no real binary)."""

    def __init__(self):
        self.selected = []
        self.configured = []

    def select(self, engine_id):
        self.selected.append(engine_id)

    def configure(self, *, threads=None, hash_mb=None, multipv=None):
        self.configured.append((threads, hash_mb))


def test_engine_options_persist_across_engine_switch():
    holder = {}

    def factory(engine, on_update):
        s = FakeSession(engine, on_update)
        holder["s"] = s
        return s

    engine = RecordingEngine()
    orch = Orchestrator(send=lambda f: None, engine=engine, session_factory=factory)
    orch.handle({"type": "set_options", "threads": 4, "hash": 128})
    orch.handle({"type": "set_engine", "id": "stockfish_lite"})
    assert engine.selected[-1] == "stockfish_lite"
    assert engine.configured[-1] == (4, 128)  # user options re-applied to the new engine
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py::test_engine_options_persist_across_engine_switch -q`
Expected: FAIL — `engine.configured` is empty (current `_restart` never calls `configure`).

- [ ] **Step 3: Implement persistence**

In `__init__`, alongside `self._depth`/`self._multipv`, add:

```python
        self._threads: Optional[int] = None
        self._hash: Optional[int] = None
```

In `set_options`, store the values (replace the `self._depth = depth` / configure block):

```python
        self._session.stop()  # join the prior worker before mutating shared state
        self._depth = depth
        self._multipv = multipv
        if threads is not None:
            self._threads = int(threads)
        if hash_mb is not None:
            self._hash = int(hash_mb)
        if (threads is not None or hash_mb is not None) and self._engine_started:
            self._engine.configure(threads=self._threads, hash_mb=self._hash)
        self._restart()
```

In `_restart`, re-apply persisted options when the engine is (re)selected:

```python
    def _restart(self) -> None:
        if not self._engine_started and hasattr(self._engine, "select"):
            self._engine.select(self._engine_id)
            self._engine_started = True
            if self._threads is not None or self._hash is not None:
                self._engine.configure(threads=self._threads, hash_mb=self._hash)
        self._session.start(self._board, depth=self._depth, multipv=self._multipv)
        self._analyzing = True
        self._send(self._state_frame(self._last_analysis, self._board))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/server/test_orchestrator.py -q`
Expected: PASS (new test passes; existing tests — which use `engine=object()` with `_threads=None` — are unaffected because the new `configure` call is guarded by `_threads/_hash is not None`).

- [ ] **Step 5: Commit**

```bash
git add chessmenthol/server/orchestrator.py tests/server/test_orchestrator.py
git commit -m "feat(server): persist Threads/Hash and re-apply on engine switch"
```

---

## Task 3: Frontend lib — `edit.ts` (pure helpers)

**Files:**
- Create: `frontend/src/lib/edit.ts`
- Test: `frontend/src/tests/edit.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/edit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildFen, kingCountOk, pieceFromToken, coordsToKey } from '../lib/edit';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

describe('buildFen', () => {
  it('builds a full FEN from the start placement, white to move', () => {
    expect(buildFen(START, 'white')).toBe(`${START} w KQkq - 0 1`);
  });
  it('uses b for black to move', () => {
    expect(buildFen(START, 'black')).toBe(`${START} b KQkq - 0 1`);
  });
  it('drops castling when the king has moved off its home square', () => {
    // white king moved e1 -> e2 (rank1 = last row): king gone from e1
    const p = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPKPPP/RNBQ1BNR';
    expect(buildFen(p, 'white')).toBe(`${p} w kq - 0 1`);
  });
  it('keeps only kingside for white when the a1 rook is missing', () => {
    const p = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR';
    expect(buildFen(p, 'white')).toBe(`${p} w Kkq - 0 1`);
  });
  it('emits - for castling when no rights remain', () => {
    const p = '4k3/8/8/8/8/8/8/4K3';
    expect(buildFen(p, 'white')).toBe(`${p} w - - 0 1`);
  });
});

describe('kingCountOk', () => {
  it('accepts exactly one king per side', () => {
    expect(kingCountOk(START)).toBe(true);
  });
  it('rejects a missing king', () => {
    expect(kingCountOk('rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(false);
  });
  it('rejects two white kings', () => {
    expect(kingCountOk('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBKR')).toBe(false);
  });
});

describe('pieceFromToken', () => {
  it('maps an uppercase token to a white piece', () => {
    expect(pieceFromToken('N')).toEqual({ role: 'knight', color: 'white' });
  });
  it('maps a lowercase token to a black piece', () => {
    expect(pieceFromToken('p')).toEqual({ role: 'pawn', color: 'black' });
  });
});

describe('coordsToKey', () => {
  it('maps board corners for white orientation', () => {
    expect(coordsToKey(0, 0, 400, 400, 'white')).toBe('a8');
    expect(coordsToKey(0, 399, 400, 400, 'white')).toBe('a1');
    expect(coordsToKey(399, 0, 400, 400, 'white')).toBe('h8');
  });
  it('flips for black orientation', () => {
    expect(coordsToKey(0, 0, 400, 400, 'black')).toBe('h1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/edit.test.ts`
Expected: FAIL — cannot resolve `../lib/edit`.

- [ ] **Step 3: Implement `edit.ts`**

Create `frontend/src/lib/edit.ts`:

```typescript
/** Pure helpers for edit mode: FEN assembly, validation, token/coord mapping. */

export interface CgPiece {
  role: 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
  color: 'white' | 'black';
}

const ROLE: Record<string, CgPiece['role']> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

/** Expand a FEN placement field into an 8x8 grid; row 0 = rank 8, col 0 = file a. */
function parsePlacement(placement: string): (string | null)[][] {
  return placement.split('/').map((row) => {
    const cells: (string | null)[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push(null);
      else cells.push(ch);
    }
    return cells;
  });
}

export function kingCountOk(placement: string): boolean {
  const w = (placement.match(/K/g) || []).length;
  const b = (placement.match(/k/g) || []).length;
  return w === 1 && b === 1;
}

/** Assemble a full FEN: side from the argument, castling inferred from king/rook
 *  home squares, en-passant '-', counters '0 1'. */
export function buildFen(placement: string, sideToMove: 'white' | 'black'): string {
  const g = parsePlacement(placement);
  const at = (row: number, col: number): string | null => g[row]?.[col] ?? null;
  // rank 1 row = g[7], rank 8 row = g[0]; files a..h = cols 0..7.
  const wK = at(7, 4) === 'K';
  const bK = at(0, 4) === 'k';
  let castle = '';
  if (wK && at(7, 7) === 'R') castle += 'K';
  if (wK && at(7, 0) === 'R') castle += 'Q';
  if (bK && at(0, 7) === 'r') castle += 'k';
  if (bK && at(0, 0) === 'r') castle += 'q';
  if (castle === '') castle = '-';
  const turn = sideToMove === 'white' ? 'w' : 'b';
  return `${placement} ${turn} ${castle} - 0 1`;
}

export function pieceFromToken(tok: string): CgPiece {
  return { role: ROLE[tok.toLowerCase()], color: tok === tok.toUpperCase() ? 'white' : 'black' };
}

/** Map a pixel offset within a square board element to a square key, given orientation. */
export function coordsToKey(
  x: number, y: number, width: number, height: number, orientation: 'white' | 'black',
): string {
  const file = Math.min(7, Math.max(0, Math.floor(x / (width / 8))));
  const rank = Math.min(7, Math.max(0, Math.floor(y / (height / 8))));
  const f = orientation === 'white' ? file : 7 - file;
  const r = orientation === 'white' ? 7 - rank : rank;
  return 'abcdefgh'[f] + (r + 1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/edit.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/edit.ts frontend/src/tests/edit.test.ts
git commit -m "feat(frontend): add pure edit-mode helpers (buildFen, kingCountOk, coordsToKey)"
```

---

## Task 4: Frontend lib — `arrows.ts` (pure)

**Files:**
- Create: `frontend/src/lib/arrows.ts`
- Test: `frontend/src/tests/arrows.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/tests/arrows.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { linesToShapes } from '../lib/arrows';

describe('linesToShapes', () => {
  it('returns no shapes when arrows are hidden', () => {
    expect(linesToShapes([{ pv: ['e2e4'] }], false)).toEqual([]);
  });
  it('draws the best move in the strong brush', () => {
    expect(linesToShapes([{ pv: ['e2e4'] }], true)).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'green' },
    ]);
  });
  it('fades lower lines', () => {
    const shapes = linesToShapes([{ pv: ['e2e4'] }, { pv: ['d2d4'] }], true);
    expect(shapes).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'green' },
      { orig: 'd2', dest: 'd4', brush: 'paleBlue' },
    ]);
  });
  it('skips lines with an empty pv', () => {
    expect(linesToShapes([{ pv: [] }, { pv: ['g1f3'] }], true)).toEqual([
      { orig: 'g1', dest: 'f3', brush: 'paleBlue' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/arrows.test.ts`
Expected: FAIL — cannot resolve `../lib/arrows`.

- [ ] **Step 3: Implement `arrows.ts`**

Create `frontend/src/lib/arrows.ts`:

```typescript
/** Pure conversion of engine PV lines into chessground auto-shapes (arrows). */
export interface Shape { orig: string; dest: string; brush: string; }

/** One arrow per line, taken from pv[0] (UCI). Best move (index 0) uses 'green',
 *  lower lines use 'paleBlue'. Empty when hidden or when a line has no pv.
 *  Note: index 0 stays 'green' even after empty-pv lines are filtered out. */
export function linesToShapes(lines: { pv: string[] }[], show: boolean): Shape[] {
  if (!show) return [];
  const shapes: Shape[] = [];
  for (let i = 0; i < lines.length; i++) {
    const uci = lines[i].pv[0];
    if (!uci) continue;
    shapes.push({
      orig: uci.slice(0, 2),
      dest: uci.slice(2, 4),
      brush: i === 0 ? 'green' : 'paleBlue',
    });
  }
  return shapes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/arrows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/arrows.ts frontend/src/tests/arrows.test.ts
git commit -m "feat(frontend): add pure linesToShapes arrow builder"
```

---

## Task 5: Frontend — `EditPalette.svelte`

**Files:**
- Create: `frontend/src/components/EditPalette.svelte`
- Test: `frontend/src/tests/EditPalette.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/EditPalette.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import EditPalette from '../components/EditPalette.svelte';

describe('EditPalette', () => {
  it('renders the palette and emits a piece token on click', async () => {
    const onSelect = vi.fn();
    render(EditPalette, { selected: 'P', onSelect });
    expect(screen.getByTestId('edit-palette')).toBeTruthy();
    await fireEvent.click(screen.getByTestId('pal-n'));
    expect(onSelect).toHaveBeenCalledWith('n');
  });

  it('emits trash for the eraser', async () => {
    const onSelect = vi.fn();
    render(EditPalette, { selected: 'P', onSelect });
    await fireEvent.click(screen.getByTestId('pal-trash'));
    expect(onSelect).toHaveBeenCalledWith('trash');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/EditPalette.test.ts`
Expected: FAIL — cannot resolve `../components/EditPalette.svelte`.

- [ ] **Step 3: Implement `EditPalette.svelte`**

Create `frontend/src/components/EditPalette.svelte`:

```svelte
<script lang="ts">
  export let selected: string | null = 'P';
  export let onSelect: (tok: string) => void = () => {};

  const TOKENS = ['P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'];
  const GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
  const glyph = (t: string) => GLYPH[t.toLowerCase()];
  const isWhite = (t: string) => t === t.toUpperCase();
</script>

<div class="palette" data-testid="edit-palette">
  {#each TOKENS as tok}
    <button data-testid={'pal-' + tok} class:on={selected === tok}
      class={isWhite(tok) ? 'pc w' : 'pc b'} on:click={() => onSelect(tok)}>{glyph(tok)}</button>
  {/each}
  <button data-testid="pal-trash" class="trash" class:on={selected === 'trash'}
    on:click={() => onSelect('trash')}>🗑</button>
</div>

<style>
  .palette { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px; padding: 6px; }
  button { font-size: 22px; width: 34px; height: 34px; line-height: 1; cursor: pointer;
    border-radius: 5px; background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15); color: inherit; }
  button.on { background: rgba(17,162,107,0.3); border-color: #11a26b; }
  .pc.w { color: #fff; text-shadow: 0 0 1px #000, 1px 1px 0 #444; }
  .pc.b { color: #111; text-shadow: 0 0 1px #fff; }
  .trash { font-size: 16px; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/EditPalette.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EditPalette.svelte frontend/src/tests/EditPalette.test.ts
git commit -m "feat(frontend): add EditPalette component"
```

---

## Task 6: Frontend — `Controls.svelte` (Edit/Done, Threads/Hash, toggles)

**Files:**
- Modify: `frontend/src/components/Controls.svelte`
- Test: `frontend/src/tests/Controls.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/tests/Controls.test.ts` (inside the existing `describe('Controls', ...)` block):

```typescript
  it('Edit button calls onToggleEdit', async () => {
    const onToggleEdit = vi.fn();
    render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish', analyzing: true,
      fen: 'startpos', onCommand: vi.fn(), onToggleEdit } as any });
    await fireEvent.click(screen.getByTestId('edit-btn'));
    expect(onToggleEdit).toHaveBeenCalled();
  });

  it('Threads input emits set_options', async () => {
    const { onCommand } = setup();
    await fireEvent.change(screen.getByTestId('threads-input'), { target: { value: '4' } });
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', threads: 4 });
  });

  it('Hash input emits set_options', async () => {
    const { onCommand } = setup();
    await fireEvent.change(screen.getByTestId('hash-input'), { target: { value: '512' } });
    expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', hash: 512 });
  });

  it('Arrows toggle calls onToggleArrows', async () => {
    const onToggleArrows = vi.fn();
    render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish', analyzing: true,
      fen: 'startpos', onCommand: vi.fn(), onToggleArrows } as any });
    await fireEvent.click(screen.getByTestId('arrows-toggle'));
    expect(onToggleArrows).toHaveBeenCalled();
  });

  it('Eval-bar toggle calls onToggleEvalBar', async () => {
    const onToggleEvalBar = vi.fn();
    render(Controls, { props: { sideToMove: 'white', engineId: 'stockfish', analyzing: true,
      fen: 'startpos', onCommand: vi.fn(), onToggleEvalBar } as any });
    await fireEvent.click(screen.getByTestId('eval-toggle'));
    expect(onToggleEvalBar).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/Controls.test.ts`
Expected: FAIL — `edit-btn` / `threads-input` etc. not found.

- [ ] **Step 3: Implement the Controls additions**

In `frontend/src/components/Controls.svelte`, add these props to the `<script>` (after the existing `export let lowConfidence` line):

```typescript
  export let editing: boolean = false;
  export let showArrows: boolean = true;
  export let showEvalBar: boolean = true;
  export let onToggleEdit: () => void = () => {};
  export let onToggleArrows: () => void = () => {};
  export let onToggleEvalBar: () => void = () => {};

  let threads = 2;
  let hashMb = 256;
  function setThreads(e: Event) {
    threads = Number((e.target as HTMLInputElement).value);
    onCommand({ type: 'set_options', threads });
  }
  function setHash(e: Event) {
    hashMb = Number((e.target as HTMLInputElement).value);
    onCommand({ type: 'set_options', hash: hashMb });
  }
```

In the **Display** section, add the two toggles after the `stop-btn` button (inside its `.btns` div):

```svelte
      <button data-testid="arrows-toggle" aria-pressed={showArrows} class:on={showArrows}
        on:click={onToggleArrows}>Arrows</button>
      <button data-testid="eval-toggle" aria-pressed={showEvalBar} class:on={showEvalBar}
        on:click={onToggleEvalBar}>Eval bar</button>
```

In the **Position** section `.btns` (after the `flip-btn`/`undo-btn`), add the Edit toggle:

```svelte
      <button data-testid="edit-btn" class:on={editing} on:click={onToggleEdit}>
        {editing ? 'Done' : 'Edit'}
      </button>
```

In the **Engine** section `.btns` (after the `engine-select`), add Threads/Hash inputs:

```svelte
      <label>Threads
        <input data-testid="threads-input" type="number" min="1" max="32"
          value={threads} on:change={setThreads} />
      </label>
      <label>Hash
        <input data-testid="hash-input" type="number" min="16" max="4096" step="16"
          value={hashMb} on:change={setHash} />
      </label>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/Controls.test.ts`
Expected: PASS (new tests pass; the 8 existing Controls tests still pass).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Controls.svelte frontend/src/tests/Controls.test.ts
git commit -m "feat(frontend): add Edit toggle, Threads/Hash inputs, display toggles to Controls"
```

---

## Task 7: Frontend — `Board.svelte` (arrows + edit)

**Files:**
- Modify: `frontend/src/components/Board.svelte`
- Test: `frontend/src/tests/Board.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/tests/Board.test.ts` (inside `describe('Board', ...)`):

```typescript
  it('mounts with arrow and edit props without throwing', () => {
    render(Board, {
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      orientation: 'white', lines: [{ multipv: 1, scoreText: '+0.2', cp: 20, mate: null,
        pv: ['e2e4'], san: 'e4' }], showArrows: true, editing: false, selectedEditPiece: 'P',
    } as any);
    expect(screen.getByTestId('board')).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/Board.test.ts`
Expected: FAIL — `Board` does not yet accept these props / the import of `../lib/arrows` etc. is absent (test renders but the new props are unknown; this drives adding them). If it passes trivially because Svelte ignores unknown props, proceed to Step 3 anyway — the implementation is still required for runtime behavior.

- [ ] **Step 3: Implement the Board changes**

Replace the entire contents of `frontend/src/components/Board.svelte` with:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chessground } from '@lichess-org/chessground';
  import { moveToUci } from '../lib/board';
  import { linesToShapes } from '../lib/arrows';
  import { coordsToKey, pieceFromToken } from '../lib/edit';
  import type { LineDto } from '../lib/types';
  import '@lichess-org/chessground/assets/chessground.base.css';
  import '@lichess-org/chessground/assets/chessground.brown.css';
  import '@lichess-org/chessground/assets/chessground.cburnett.css';

  export let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  export let orientation: 'white' | 'black' = 'white';
  /** Called with a UCI string when the USER makes a move on the board. */
  export let onMove: (uci: string) => void = () => {};
  /** Bump this (e.g. on a rejected-move error) to force a re-sync to `fen`. */
  export let revertSignal = 0;
  export let lines: LineDto[] = [];
  export let showArrows = true;
  export let editing = false;
  export let selectedEditPiece: string | null = 'P';

  type CgApi = ReturnType<typeof Chessground>;
  let el: HTMLDivElement;
  let cg: CgApi | undefined;

  function isPromotion(dest: string): boolean {
    return dest[1] === '1' || dest[1] === '8';
  }

  /** Current placement field, for committing an edit. */
  export function getPlacement(): string {
    return cg ? cg.getFen() : fen.split(' ')[0];
  }

  function editPlace(key: string): void {
    if (!cg || !editing || !selectedEditPiece) return;
    const piece = selectedEditPiece === 'trash' ? undefined : pieceFromToken(selectedEditPiece);
    cg.setPieces(new Map([[key as any, piece as any]]));
  }

  function onContextMenu(ev: MouseEvent): void {
    if (!cg || !editing) return;
    ev.preventDefault();
    const r = el.getBoundingClientRect();
    const key = coordsToKey(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height, orientation);
    cg.setPieces(new Map([[key as any, undefined as any]]));
  }

  onMount(() => {
    try {
      cg = Chessground(el, {
        fen,
        orientation,
        movable: {
          free: true,
          color: 'both',
          showDests: false,
          events: {
            after: (orig: string, dest: string) => {
              if (editing) return; // in edit mode a drag just rearranges locally
              const promo = isPromotion(dest) ? 'q' : undefined;
              onMove(moveToUci(orig, dest, promo));
            },
          },
        },
        drawable: { enabled: true, visible: true, autoShapes: [] },
        events: { select: (key: string) => editPlace(key) },
      });
    } catch (err) {
      // chessground reads DOM geometry that jsdom lacks; in the browser this
      // succeeds. Keep the container mounted even if init fails under jsdom.
      console.error('chessground init failed', err);
    }
  });

  onDestroy(() => cg?.destroy());

  // Never let an incoming fen update clobber an in-progress local edit.
  $: if (cg && !editing) cg.set({ fen, orientation });
  $: forceSync(revertSignal);
  function forceSync(_signal: number): void {
    if (cg && !editing) cg.set({ fen, orientation });
  }
  // Arrows: recompute on lines / toggle / mode change. Suppressed while editing.
  $: if (cg) cg.setAutoShapes(linesToShapes(lines, showArrows && !editing) as any);
</script>

<div class="board" data-testid="board" bind:this={el} on:contextmenu={onContextMenu}></div>

<style>
  .board { width: 100%; aspect-ratio: 1 / 1; }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/Board.test.ts`
Expected: PASS (both the original mount test and the new props test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Board.svelte frontend/src/tests/Board.test.ts
git commit -m "feat(frontend): draw PV arrows and support palette editing on the board"
```

---

## Task 8: Frontend — `App.svelte` wiring

**Files:**
- Modify: `frontend/src/App.svelte`

> This task is integration glue. The unit-testable pieces are covered by Tasks 3–7; the wiring here is verified manually (Step 4). No new automated test is added because `App.svelte` calls `connect()` (a real WebSocket) on mount and is not rendered in the existing suite.

- [ ] **Step 1: Implement the wiring**

Replace the `<script>` block of `frontend/src/App.svelte` with:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { state, lastError, connected, errorSeq, connect, send } from './lib/ws';
  import type { Command } from './lib/types';
  import { buildFen, kingCountOk } from './lib/edit';
  import Board from './components/Board.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import Lines from './components/Lines.svelte';
  import Badge from './components/Badge.svelte';
  import Controls from './components/Controls.svelte';
  import EditPalette from './components/EditPalette.svelte';

  let orientation: 'white' | 'black' = 'white';
  let manualFlip = false;
  let editing = false;
  let selectedEditPiece: string | null = 'P';
  let showArrows = true;
  let showEvalBar = true;
  let editError: string | null = null;
  let committing = false;
  let lastSeq = 0;
  let boardComp: Board;

  onMount(() => { connect(); });

  function onCommand(cmd: Command) {
    if (cmd.type === 'set_auto' && cmd.on) manualFlip = false;
    send(cmd);
  }
  function onFlip() { manualFlip = true; orientation = orientation === 'white' ? 'black' : 'white'; }
  function onMove(uci: string) { send({ type: 'make_move', uci }); }

  function onToggleEdit() {
    if (!editing) {
      editError = null;
      send({ type: 'set_auto', on: false }); // freeze the board while editing
      editing = true;
      return;
    }
    const placement = boardComp.getPlacement();
    if (!kingCountOk(placement)) {
      editError = 'Need exactly one white and one black king.';
      return; // stay in edit mode
    }
    editError = null;
    lastSeq = $errorSeq;
    committing = true;
    send({ type: 'set_fen', fen: buildFen(placement, s?.sideToMove ?? 'white') });
    editing = false;
  }
  function onSelectPiece(tok: string) { selectedEditPiece = tok; }

  $: s = $state;
  $: fen = s?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  $: if (s?.tracking && s?.detectedOrientation && !manualFlip) {
    orientation = s.detectedOrientation as 'white' | 'black';
  }
  // If the server rejected the commit, drop back into edit mode so the fix isn't lost.
  $: if (committing && $errorSeq !== lastSeq) {
    committing = false; editing = true; editError = $lastError;
  }
  // A state frame after a commit means it was accepted.
  $: if (committing && s) { committing = false; }
</script>
```

Then update the markup `<div class="app"> ... </div>` to:

```svelte
  <div class="app">
    {#if showEvalBar}<EvalBar evalDto={s?.eval ?? null} />{/if}
    <div class="board-wrap">
      <Board bind:this={boardComp} {fen} {orientation} {onMove} revertSignal={$errorSeq}
        lines={s?.lines ?? []} {showArrows} {editing} {selectedEditPiece} />
      {#if editing}
        <EditPalette selected={selectedEditPiece} onSelect={onSelectPiece} />
      {/if}
      {#if editError}<div class="err" data-testid="edit-error">{editError}</div>{/if}
    </div>
    <aside class="panel">
      <div class="box"><div class="label">Engine lines</div>
        <Lines lines={s?.lines ?? []} />
      </div>
      <div class="box"><div class="label">Last move</div>
        <Badge lastMove={s?.lastMove ?? null} />
      </div>
      <div class="box"><div class="label">Controls</div>
        <Controls sideToMove={s?.sideToMove ?? 'white'} engineId={s?.engineId ?? 'stockfish'}
          analyzing={s?.analyzing ?? false} fen={s?.fen ?? ''}
          tracking={s?.tracking ?? false}
          visionStatus={s?.visionStatus ?? 'off'}
          lowConfidence={s?.lowConfidence ?? []}
          editing={editing} showArrows={showArrows} showEvalBar={showEvalBar}
          onToggleEdit={onToggleEdit}
          onToggleArrows={() => (showArrows = !showArrows)}
          onToggleEvalBar={() => (showEvalBar = !showEvalBar)}
          {onCommand} {onFlip} />
      </div>
      {#if $lastError}<div class="err">{$lastError}</div>{/if}
    </aside>
  </div>
```

- [ ] **Step 2: Run the whole frontend suite (no regressions)**

Run: `cd frontend && npx vitest run`
Expected: PASS — all frontend tests (existing + new from Tasks 3–7) green.

- [ ] **Step 3: Build the frontend into the server's static dir**

Run: `cd frontend && npm run build`
Expected: build succeeds; `chessmenthol/server/static/` is refreshed. (Confirm the build script outputs there — Milestone 2b configured it.)

- [ ] **Step 4: Manual verification**

Run: `.venv/bin/chessmenthol-server`, open http://127.0.0.1:8765/, then check:
- Engine lines show **arrows** on the board; the **Arrows** toggle hides/shows them; the best move is the strong arrow.
- **Eval bar** toggle hides/shows the eval bar.
- **Threads/Hash** inputs change without error; switching engine keeps them applied.
- **Edit**: click Edit → palette appears, Auto turns off; click a piece then a square to place; right-click a square to clear; click **Done** → board commits and analysis resumes. Removing a king and clicking Done shows the "one king per side" message and stays in edit mode.
- **Hard pause**: with Auto on, dragging a variation move turns Auto off (tracker stops fighting you); re-enabling Auto re-detects the screen.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.svelte chessmenthol/server/static
git commit -m "feat(frontend): wire edit mode, arrows, and display toggles into the app"
```

---

## Final verification

- [ ] Run the full Python suite: `.venv/bin/pytest -q` → all pass (engine tests auto-skip without Stockfish).
- [ ] Run the full frontend suite: `cd frontend && npx vitest run` → all pass.
- [ ] Confirm the manual checks in Task 8 Step 4 all behave as described.
