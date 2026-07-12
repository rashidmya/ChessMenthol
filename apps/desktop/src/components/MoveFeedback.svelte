<script lang="ts">
  import type { LastMoveDto } from '@chessmenthol/core/lib/types';
  import MoveBadge from './MoveBadge.svelte';
  import { resultText } from '@chessmenthol/core/lib/evalbar';

  export let lastMove: LastMoveDto | null = null;
  export let evaluating: { san: string } | null = null;
  export let onPlayBest: (uci: string) => void = () => {};
  export let gameOver: { result: string; reason: string } | null = null;

  // phraseFor renders the class name in every row; 'best'/'great'/'brilliant'
  // (which imply isBest) read their true label instead of collapsing to "best".
  // The `?? label` fallback covers any unknown class.
  const PHRASE: Record<string, string> = {
    brilliant: 'brilliant', great: 'great', best: 'best', excellent: 'excellent', good: 'good',
    inaccuracy: 'an inaccuracy',
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

  function resultClass(r: string): 'wadv' | 'badv' | 'draw' {
    if (r === '1-0') return 'wadv';
    if (r === '0-1') return 'badv';
    return 'draw';
  }

</script>

{#if !lastMove && evaluating}
  <div class="lm" data-testid="evaluating">
    <div class="mrow">
      <span class="mtext">
        <!-- SAN wrapped in .san for figurine-font consistency with the other move rows.
             Tests assert via textContent (recursive), not getByText (direct text nodes only). -->
        <span class="mname"><span class="san">{evaluating.san}</span> was played</span>
      </span>
    </div>
    <div class="evaluating">Evaluating<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>
  </div>
{/if}

{#if lastMove}
  {#if gameOver}
    <div class="lm" data-testid="movefeedback">
      <div class="mrow" data-testid="row-gameover">
        <span class="badge {resultClass(gameOver.result)}">{resultText(gameOver.result)}</span>
        <MoveBadge label={lastMove.classification.label} size={20} />
        <span class="mtext">
          <span class="mname {lastMove.classification.isBest ? 'best' : 'mist'}">
            <span class="san">{lastMove.played.san}</span> <span class="desc">is {phraseFor(lastMove.classification.label)}</span>
          </span>
        </span>
      </div>
    </div>
  {:else}
    <div class="lm" data-testid="movefeedback">
      {#if lastMove.classification.isBest}
        <div class="mrow" data-testid="row-best">
          <span class="badge {evalClass(lastMove.best.evalText)}">{lastMove.best.evalText}</span>
          <MoveBadge label={lastMove.classification.label} size={20} />
          <span class="mtext">
            <span class="mname best"><span class="san">{lastMove.best.san}</span> <span class="desc">is {phraseFor(lastMove.classification.label)}</span></span>
            {#if lastMove.best.pv}<span class="cont">{lastMove.best.pv}</span>{/if}
          </span>
        </div>
      {:else}
        <div class="mrow" data-testid="row-played">
          <span class="badge {evalClass(lastMove.played.evalText)}">{lastMove.played.evalText}</span>
          <MoveBadge label={lastMove.classification.label} size={20} />
          <span class="mtext">
            <span class="mname mist"><span class="san">{lastMove.played.san}</span> <span class="desc">is {phraseFor(lastMove.classification.label)}</span></span>
            {#if lastMove.played.pv}<span class="cont">{lastMove.played.pv}</span>{/if}
          </span>
        </div>
        <button class="mrow" data-testid="play-best"
          title="Undo and play the best move"
          aria-label="Undo and play the best move: {lastMove.best.san}"
          on:click={play}>
          <span class="badge {evalClass(lastMove.best.evalText)}">{lastMove.best.evalText}</span>
          <MoveBadge label="best" size={20} />
          <span class="mtext">
            <span class="mname best"><span class="san">{lastMove.best.san}</span> <span class="desc">is best</span></span>
            {#if lastMove.best.pv}<span class="cont">{lastMove.best.pv}</span>{/if}
          </span>
        </button>
      {/if}
    </div>
  {/if}
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
  .badge.draw { background: var(--keyline); color: var(--ink-2); }
  .mtext { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; overflow: hidden; }
  .mname { flex: none; font-weight: 700; font-size: 13px; letter-spacing: -.01em; }
  .mname .san { font-family: var(--figurine), 'Hanken Grotesk', sans-serif; }
  .mname .desc { font-weight: 600; }
  .mname.mist .desc { color: #cf7a1e; }
  .mname.best .desc { color: #5b8a3c; }
  .cont { flex: 1; min-width: 0; font-family: var(--figurine), monospace; font-size: 11px;
    color: #a8a193; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .evaluating { padding: 2px 8px 6px; font-family: var(--mono); font-size: 11px; letter-spacing: .1em;
    text-transform: uppercase; color: var(--ink-faint); }
  .evaluating .dots span { animation: blink 1.2s infinite both; }
  .evaluating .dots span:nth-child(2) { animation-delay: .2s; }
  .evaluating .dots span:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: .2; } 40% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .evaluating .dots span { animation: none; opacity: 1; } }
</style>
