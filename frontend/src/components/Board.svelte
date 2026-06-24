<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chessground } from '@lichess-org/chessground';
  import { moveToUci } from '../lib/board';
  import '@lichess-org/chessground/assets/chessground.base.css';
  import '@lichess-org/chessground/assets/chessground.brown.css';
  import '@lichess-org/chessground/assets/chessground.cburnett.css';

  export let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  export let orientation: 'white' | 'black' = 'white';
  /** Called with a UCI string when the USER makes a move on the board. */
  export let onMove: (uci: string) => void = () => {};

  type CgApi = ReturnType<typeof Chessground>;
  let el: HTMLDivElement;
  let cg: CgApi | undefined;

  function isPromotion(dest: string): boolean {
    return dest[1] === '1' || dest[1] === '8';
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
              const promo = isPromotion(dest) ? 'q' : undefined;
              onMove(moveToUci(orig, dest, promo));
            },
          },
        },
      });
    } catch (err) {
      // chessground reads DOM geometry that jsdom lacks; in the browser this
      // succeeds. Keep the container mounted even if init fails under jsdom.
      console.error('chessground init failed', err);
    }
  });

  onDestroy(() => cg?.destroy());

  $: if (cg) cg.set({ fen, orientation });
</script>

<div class="board" data-testid="board" bind:this={el}></div>

<style>
  .board { width: 100%; aspect-ratio: 1 / 1; }
</style>
