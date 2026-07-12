<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chessground } from '@lichess-org/chessground';
  import { moveToUci, turnColor, legalDests, promotionPiece, lastMoveSquares } from '@chessmenthol/core/lib/board';
  import { linesToShapes } from '@chessmenthol/core/lib/arrows';
  import { coordsToKey, pieceFromToken } from '@chessmenthol/core/lib/edit';
  import type { LineDto } from '@chessmenthol/core/lib/types';
  import '@lichess-org/chessground/assets/chessground.base.css';
  import '@lichess-org/chessground/assets/chessground.brown.css';
  import '@lichess-org/chessground/assets/chessground.cburnett.css';

  export let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  export let orientation: 'white' | 'black' = 'white';
  /** Called with a UCI string when the USER makes a move on the board. */
  export let onMove: (uci: string) => void = () => {};
  /** Bump this (e.g. on a rejected-move error) to force a re-sync to `fen`. */
  export let revertSignal = 0;
  /** UCI of the move that led to the current position (or null at the start).
   *  Drives chessground's yellow last-move highlight from authoritative app
   *  state, so it follows navigation and clears on reset/New — chessground's own
   *  internal tracking only updates on a user drag and would otherwise leave a
   *  stale highlight after an external position change. */
  export let lastMove: string | null = null;
  export let lines: LineDto[] = [];
  export let showArrows = true;
  export let editing = false;
  export let selectedEditPiece: string | null = 'P';
  /** Called with the new placement field after each free edit (palette/right-click). */
  export let onEdit: (placement: string) => void = () => {};

  type CgApi = ReturnType<typeof Chessground>;
  let el: HTMLDivElement;
  let cg: CgApi | undefined;

  /** Current placement field, for committing an edit. */
  export function getPlacement(): string {
    return cg ? cg.getFen() : fen.split(' ')[0];
  }

  /** Force the board to a placement even while editing (used by reset/clear). */
  export function setPlacement(placement: string): void {
    cg?.set({ fen: placement });
  }

  /** chessground movable config: legal-only for the side to move in normal play
   *  (illegal drags snap back, nothing is sent), free placement while editing.
   *  Typed `any` to bridge chessground's branded Key/Dests types. */
  function movableConfig(fenStr: string, isEditing: boolean): any {
    return isEditing
      ? { free: true, color: 'both' }
      : { free: false, color: turnColor(fenStr), dests: legalDests(fenStr) };
  }

  function editPlace(key: string): void {
    if (!cg || !editing || !selectedEditPiece) return;
    const piece = selectedEditPiece === 'trash' ? undefined : pieceFromToken(selectedEditPiece);
    cg.setPieces(new Map([[key as any, piece as any]]));
    onEdit(cg.getFen());
  }

  function onContextMenu(ev: MouseEvent): void {
    if (!cg || !editing) return;
    ev.preventDefault();
    const r = el.getBoundingClientRect();
    const key = coordsToKey(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height, orientation);
    cg.setPieces(new Map([[key as any, undefined as any]]));
    onEdit(cg.getFen());
  }

  onMount(() => {
    try {
      cg = Chessground(el, {
        fen,
        turnColor: turnColor(fen),
        lastMove: lastMoveSquares(lastMove) as any,
        orientation,
        movable: {
          ...movableConfig(fen, editing),
          showDests: false,
          events: {
            after: (orig: string, dest: string) => {
              if (editing) return; // in edit mode a drag just rearranges locally
              const promo = promotionPiece(fen, orig, dest);
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

  // Orientation always syncs (Flip works even mid-edit, keeping right-click coordsToKey correct);
  // fen only syncs when NOT editing, so an incoming position never clobbers a local edit.
  // turnColor must ride along with the fen: chessground's fen reader loads only the
  // PLACEMENT, and otherwise flips turnColor solely when the *user* drags. Without this,
  // an in-app move toggles turnColor and a later capture/revert (which changes the fen
  // but not via a drag) leaves turnColor stuck on the wrong side -> the board freezes,
  // because chessground gates dragging on `turnColor === piece.color`.
  $: if (cg) cg.set({ orientation });
  // Sync the position AND the last-move highlight together: chessground only
  // clears its yellow last-move squares when `lastMove` is present in the
  // config, so `lastMove` must ride along with every fen sync (else a reset /
  // navigation leaves the previous move highlighted). lastMoveSquares(null)
  // returns undefined, which chessground reads as "clear it". Kept inline (not
  // extracted to a helper) so `cg`/`editing` stay syntactic deps of the legacy
  // `$:` statement — a re-sync must still fire when `editing` flips back off.
  $: if (cg && !editing) cg.set({ fen, turnColor: turnColor(fen), lastMove: lastMoveSquares(lastMove) as any });
  // The board editor has no "last move" — clear the highlight on entering edit
  // so a prior game's yellow squares don't bleed into the setup board. The fen
  // sync above is `!editing`-gated and so can't do this itself.
  $: if (cg && editing) cg.set({ lastMove: undefined as any });
  $: forceSync(revertSignal);
  function forceSync(_signal: number): void {
    if (cg && !editing) cg.set({ fen, turnColor: turnColor(fen), lastMove: lastMoveSquares(lastMove) as any });
  }
  // Arrows: recompute on lines / toggle / mode / turn change. Suppressed while
  // editing. turnColor(fen) gives the mover's POV so weaker-line widths read
  // White-POV evals correctly (Lichess parity).
  $: if (cg) cg.setAutoShapes(linesToShapes(lines, showArrows && !editing, turnColor(fen)) as any);
  // Movable: legal-only for the side to move in normal play; free placement while editing.
  $: if (cg) cg.set({ movable: movableConfig(fen, editing) });
  // Drawing: in the editor right-click deletes pieces and clicks place them, so
  // turn chessground's shape drawing (arrows/circles) off; re-enable in play.
  $: if (cg) cg.set({ drawable: { enabled: !editing } });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="board" data-testid="board" bind:this={el} on:contextmenu={onContextMenu}></div>

<style>
  .board { width: 100%; aspect-ratio: 1 / 1; }

  /* Coordinate labels (chessground's runtime-created `coords`): pin them into the
     board corners, keep the files lowercase, and make them larger + extrabold.
     chessground's vendored base CSS centers/offsets the labels a few px off the
     corners and uppercases the file letters; we override that here. Reaching
     chessground's dynamically-inserted DOM needs `:global`, and the
     `.board.cg-wrap` double class (chessground adds `cg-wrap` onto our `.board`
     div) lifts specificity above the vendor rules so these win regardless of
     stylesheet insertion order. Colors still come from chessground.brown.css. */
  :global(.board.cg-wrap coords) {
    font-size: 15px;
    font-weight: 800;
  }
  /* rank numbers -> top-left corner of the left column (drop the -20px/translateY nudge) */
  :global(.board.cg-wrap coords.ranks) {
    top: 0;
    left: 2px;
  }
  :global(.board.cg-wrap coords.ranks coord) {
    transform: none;
  }
  /* file letters -> bottom-right corner of each column, lowercase (drop the 24px/-4px offset) */
  :global(.board.cg-wrap coords.files) {
    left: 0;
    bottom: 5px;
    text-transform: none;
    text-align: right;
  }
  /* Pad each letter, NOT the row: padding on the container would shrink the
     flexed row so the 8 slices no longer line up with the 8 board columns and
     the offset accumulates rightward. Per-coord padding keeps every letter the
     same distance from its own column's right edge. */
  :global(.board.cg-wrap coords.files coord) {
    padding-right: 5px;
  }
  /* Pinning the numbers into the corner lands each on its own rank's left-column
     square, whose light/dark colour is the opposite of where chessground's default
     label position sat -> the built-in parity (chessground.brown.css) gave the
     numbers no contrast. Swap the two rank colours per orientation to restore the
     alternation. Files already land on the correctly-coloured square, so untouched. */
  :global(.board.cg-wrap.orientation-white coords.ranks coord:nth-child(odd)) {
    color: rgba(255, 255, 255, 0.8);
  }
  :global(.board.cg-wrap.orientation-white coords.ranks coord:nth-child(even)) {
    color: rgba(72, 72, 72, 0.8);
  }
  :global(.board.cg-wrap.orientation-black coords.ranks coord:nth-child(odd)) {
    color: rgba(72, 72, 72, 0.8);
  }
  :global(.board.cg-wrap.orientation-black coords.ranks coord:nth-child(even)) {
    color: rgba(255, 255, 255, 0.8);
  }
</style>
