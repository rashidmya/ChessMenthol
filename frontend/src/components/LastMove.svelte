<script lang="ts">
  import type { LastMoveDto } from '../lib/types';
  import { toFigurine } from '../lib/figurine';
  import MoveBadge from './MoveBadge.svelte';

  export let lastMove: LastMoveDto | null = null;
  export let onPlayBest: (uci: string) => void = () => {};

  // phraseFor only runs in the played (non-best) row, so 'best'/'great' (which
  // imply isBest) never reach it; the `?? label` fallback covers any unknown.
  const PHRASE: Record<string, string> = {
    brilliant: 'brilliant', excellent: 'excellent', good: 'good',
    book: 'a book move', inaccuracy: 'an inaccuracy',
    mistake: 'a mistake', blunder: 'a blunder', miss: 'a miss',
  };
  const phraseFor = (label: string) => PHRASE[label] ?? label;

  // A function-local guard narrows `lastMove` cleanly (avoids svelte-check
  // complaining about a closure over the possibly-null prop in the template).
  function play() { if (lastMove) onPlayBest(lastMove.best.uci); }
</script>

{#if lastMove}
  <div class="lm" data-testid="lastmove">
    {#if lastMove.classification.isBest}
      <div class="row best" data-testid="row-best">
        <span class="eval">{lastMove.best.evalText}</span>
        <MoveBadge label="best" size={20} />
        <span class="name">{lastMove.best.san} is best</span>
        {#if lastMove.best.pv}<span class="pv">{toFigurine(lastMove.best.pv)}</span>{/if}
      </div>
    {:else}
      <div class="row label-{lastMove.classification.label}" data-testid="row-played">
        <span class="eval">{lastMove.played.evalText}</span>
        <MoveBadge label={lastMove.classification.label} size={20} />
        <span class="name">{lastMove.played.san} is {phraseFor(lastMove.classification.label)}</span>
        {#if lastMove.played.pv}<span class="pv">{toFigurine(lastMove.played.pv)}</span>{/if}
      </div>
      <button class="row best" data-testid="play-best"
        title="Undo and play the best move"
        aria-label="Undo and play the best move: {lastMove.best.san}"
        on:click={play}>
        <span class="eval">{lastMove.best.evalText}</span>
        <MoveBadge label="best" size={20} />
        <span class="name">{lastMove.best.san} is best</span>
        {#if lastMove.best.pv}<span class="pv">{toFigurine(lastMove.best.pv)}</span>{/if}
      </button>
    {/if}
  </div>
{/if}

<style>
  .lm { display: flex; flex-direction: column; gap: 6px; }
  .row { display: grid; grid-template-columns: auto auto 1fr; align-items: center;
    gap: 8px; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.05);
    text-align: left; width: 100%; }
  button.row { font: inherit; color: inherit; border: 1px solid rgba(255,255,255,0.12);
    cursor: pointer; }
  button.row:hover { background: rgba(129,182,76,0.18); border-color: #81b64c; }
  .eval { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 13px;
    color: #e6e6e6; }
  .name { font-size: 13px; }
  .pv { grid-column: 3; justify-self: start; font-size: 11px; opacity: 0.7;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    grid-row: 2; padding-left: 2px; }
</style>
