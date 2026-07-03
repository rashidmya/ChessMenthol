<script lang="ts">
  import type { EvalDto } from '../lib/types';
  import { whitePct, resultText, resultPct } from '../lib/evalbar';
  export let evalDto: EvalDto | null = null;
  export let orientation: 'white' | 'black' = 'white';
  export let gameOver: { result: string; reason: string } | null = null;
  export let horizontal = false;

  $: flipped = orientation === 'black';
  $: pct = gameOver ? resultPct(gameOver.result) : whitePct(evalDto);
  $: text = gameOver ? resultText(gameOver.result) : scoreText(evalDto);
  $: aheadIsWhite = pct >= 50;
  // The score sits at the favored side's END of the bar. White's end is the bottom
  // unless the board is flipped; black's end is the opposite. So the score is at the
  // bottom exactly when (white-ahead) XOR (flipped).
  $: scoreAtBottom = aheadIsWhite !== flipped;
  // Horizontal reuses the same favored-side logic (bottom↔left, top↔right).
  $: fillStyle = horizontal
    ? `${flipped ? 'right' : 'left'}:0; width:${pct}%`
    : `${flipped ? 'top' : 'bottom'}:0; height:${pct}%`;
  $: scoreStyle = horizontal
    ? `${scoreAtBottom ? 'left' : 'right'}:8px`
    : `${scoreAtBottom ? 'bottom' : 'top'}:6px`;

  function scoreText(ev: EvalDto | null): string {
    if (!ev) return '0.0';
    if (ev.mate != null) return `M${Math.abs(ev.mate)}`;
    return Math.abs((ev.cp ?? 0) / 100).toFixed(1);
  }
</script>

<div class="evalbar" class:horizontal data-testid="evalbar">
  <div class="fill" data-testid="eval-fill" style={fillStyle}></div>
  <div class="mid"></div>
  <span class="sc" class:light={!aheadIsWhite} data-testid="eval-score"
    style={scoreStyle}>{text}</span>
</div>

<style>
  .evalbar {
    position: relative;
    width: 30px;
    height: var(--bsize, 100%);
    border: 1px solid var(--keyline-2, #cfc7b3);
    border-radius: 5px;
    background: #211f1a;
    overflow: hidden;
    box-shadow: inset 0 1px 4px rgba(0,0,0,.45);
  }
  .fill {
    position: absolute;
    left: 0;
    right: 0;
    background: linear-gradient(180deg,#f8f5ef,#e6e2d6);
    box-shadow: inset 0 1px 0 #fff;
    transition: height 1s cubic-bezier(.2,.8,.2,1);
  }
  .mid {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: rgba(0,0,0,.4);
  }
  .sc {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    font-family: var(--mono, 'Space Mono', monospace);
    font-size: 12px;
    font-weight: 700;
    color: #2e2b25;
    font-variant-numeric: tabular-nums;
  }
  .sc.light { color: #f4f1ea; }

  /* Horizontal variant (narrow / mobile): a thin strip above the board. */
  .evalbar.horizontal { width: 100%; height: 14px; }
  .evalbar.horizontal .fill {
    top: 0; bottom: 0; left: auto; right: auto;
    background: linear-gradient(90deg, #f8f5ef, #e6e2d6);
    transition: width 1s cubic-bezier(.2,.8,.2,1);
  }
  .evalbar.horizontal .mid { top: 0; bottom: 0; left: 50%; right: auto; height: auto; width: 1px; }
  .evalbar.horizontal .sc { top: 50%; transform: translateY(-50%); left: auto; right: auto; font-size: 10px; }
</style>
