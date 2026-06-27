<script lang="ts">
  import type { EvalDto } from '../lib/types';
  import { whitePct } from '../lib/evalbar';
  export let evalDto: EvalDto | null = null;
  $: pct = whitePct(evalDto);
  $: score = format(evalDto);
  function format(ev: EvalDto | null): string {
    if (!ev) return '0.0';
    if (ev.mate != null) return `M${Math.abs(ev.mate)}`;
    return Math.abs((ev.cp ?? 0) / 100).toFixed(2);
  }
</script>

<div class="evalbar" data-testid="evalbar">
  <div class="fill" data-testid="eval-fill" style="height:{pct}%"></div>
  <div class="mid"></div>
  <span class="sc" data-testid="eval-score">{score}</span>
</div>

<style>
  /* ported from MOCKUP lines 57-64 */
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
    bottom: 0;
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
    bottom: 6px;
    text-align: center;
    font-family: var(--mono, 'Space Mono', monospace);
    font-size: 12px;
    font-weight: 700;
    color: #2e2b25;
    font-variant-numeric: tabular-nums;
  }
</style>
