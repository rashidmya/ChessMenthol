<script lang="ts">
  import MoveBadge from './MoveBadge.svelte';
  import { squareCorner } from '../lib/boardBadge';
  import type { LastMoveDto } from '../lib/types';

  export let lastMove: LastMoveDto | null = null;
  export let orientation: 'white' | 'black' = 'white';

  let width = 0; // overlay width in px; one square = width / 8

  // Destination square = UCI chars 3-4 (handles promotion 'e7e8q' and castling 'e1g1').
  $: dest = lastMove?.played.uci ? lastMove.played.uci.slice(2, 4) : null;
  $: corner = dest ? squareCorner(dest, orientation) : null;
  $: badgeSize = (width / 8) * 0.46;
</script>

<div class="board-badge-layer" bind:clientWidth={width} aria-hidden="true">
  {#if lastMove && corner}
    <div class="anchor" data-testid="board-badge"
         style="left:{corner.leftPct}%; top:{corner.topPct}%">
      <MoveBadge label={lastMove.classification.label} size={badgeSize} />
    </div>
  {/if}
</div>

<style>
  .board-badge-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
  .anchor { position: absolute; transform: translate(-50%, -50%); }
</style>
