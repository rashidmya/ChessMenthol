<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chessground } from '@lichess-org/chessground';
  import { moveToUci, turnColor, legalDests, promotionPiece } from '../lib/board';
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

  /** Current placement field, for committing an edit. */
  export function getPlacement(): string {
    return cg ? cg.getFen() : fen.split(' ')[0];
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
  $: if (cg) cg.set({ orientation });
  $: if (cg && !editing) cg.set({ fen });
  $: forceSync(revertSignal);
  function forceSync(_signal: number): void {
    if (cg && !editing) cg.set({ fen });
  }
  // Arrows: recompute on lines / toggle / mode change. Suppressed while editing.
  $: if (cg) cg.setAutoShapes(linesToShapes(lines, showArrows && !editing) as any);
  // Movable: legal-only for the side to move in normal play; free placement while editing.
  $: if (cg) cg.set({ movable: movableConfig(fen, editing) });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="board" data-testid="board" bind:this={el} on:contextmenu={onContextMenu}></div>

<style>
  .board { width: 100%; aspect-ratio: 1 / 1; }
</style>
