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

  // wadv = White better (positive eval), badv = Black better (negative eval).
  // Treat as badv when evalText (trimmed) starts with '-' or '−' (minus), else wadv.
  function evalClass(evalText: string): 'wadv' | 'badv' {
    const t = evalText.trim();
    return (t.startsWith('-') || t.startsWith('−')) ? 'badv' : 'wadv';
  }
</script>

{#if lastMove}
  <div class="lm" data-testid="movefeedback">
    {#if lastMove.classification.isBest}
      <div class="mrow" data-testid="row-best">
        <span class="badge {evalClass(lastMove.best.evalText)}">{lastMove.best.evalText}</span>
        <MoveBadge label="best" size={20} />
        <span class="mtext">
          <span class="mname best">{lastMove.best.san} <span class="desc">is best</span></span>
          {#if lastMove.best.pv}<span class="cont">{toFigurine(lastMove.best.pv)}</span>{/if}
        </span>
      </div>
    {:else}
      <div class="mrow" data-testid="row-played">
        <span class="badge {evalClass(lastMove.played.evalText)}">{lastMove.played.evalText}</span>
        <MoveBadge label={lastMove.classification.label} size={20} />
        <span class="mtext">
          <span class="mname mist">{lastMove.played.san} <span class="desc">is {phraseFor(lastMove.classification.label)}</span></span>
          {#if lastMove.played.pv}<span class="cont">{toFigurine(lastMove.played.pv)}</span>{/if}
        </span>
      </div>
      <button class="mrow" data-testid="play-best"
        title="Undo and play the best move"
        aria-label="Undo and play the best move: {lastMove.best.san}"
        on:click={play}>
        <span class="badge {evalClass(lastMove.best.evalText)}">{lastMove.best.evalText}</span>
        <MoveBadge label="best" size={20} />
        <span class="mtext">
          <span class="mname best">{lastMove.best.san} <span class="desc">is best</span></span>
          {#if lastMove.best.pv}<span class="cont">{toFigurine(lastMove.best.pv)}</span>{/if}
        </span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .lm { display: flex; flex-direction: column; }
  .mrow { display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: 6px;
    width: 100%; text-align: left; font: inherit; color: inherit; background: transparent; border: none; }
  .mrow + .mrow { border-top: 1px solid #e0dacb; }
  button.mrow { cursor: pointer; transition: .14s; }
  button.mrow:hover { background: #f1ede3; }
  .badge { flex: none; font-family: monospace; font-weight: 700; font-size: 11.5px;
    padding: 3px 7px; border-radius: 5px; min-width: 52px; text-align: center;
    font-variant-numeric: tabular-nums; border: 1px solid #cfc7b3; }
  .badge.wadv { background: #f7f4ec; color: #1b1916; }
  .badge.badv { background: #2b2723; color: #f4f1ea; border-color: #46413a; }
  .mtext { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; overflow: hidden; }
  .mname { flex: none; font-weight: 700; font-size: 13px; letter-spacing: -.01em; }
  .mname .desc { font-weight: 600; }
  .mname.mist .desc { color: #cf7a1e; }
  .mname.best .desc { color: #5b8a3c; }
  .cont { flex: 1; min-width: 0; font-family: monospace; font-size: 11px;
    color: #a8a193; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
