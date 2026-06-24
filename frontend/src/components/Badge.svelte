<script lang="ts">
  import type { LastMoveDto } from '../lib/types';
  export let lastMove: LastMoveDto | null = null;
  const SYMBOL: Record<string, string> = {
    brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓',
    book: '📖', inaccuracy: '?!', mistake: '?', blunder: '??', miss: '✗',
  };
</script>

{#if lastMove}
  <span class="badge label-{lastMove.classification.label}" data-testid="badge">
    <span class="sym">{SYMBOL[lastMove.classification.label] ?? ''}</span>
    {lastMove.classification.label}
  </span>
{/if}

<style>
  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
    padding: 3px 9px; border-radius: 20px; background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.2); text-transform: capitalize; }
  .sym { font-weight: 700; }
  .label-brilliant { border-color: #1abc9c; color: #1abc9c; }
  .label-great { border-color: #3498db; color: #3498db; }
  .label-best, .label-excellent, .label-good { border-color: #81b64c; color: #81b64c; }
  .label-inaccuracy { border-color: #f7c631; color: #f7c631; }
  .label-mistake, .label-miss { border-color: #e58f2a; color: #e58f2a; }
  .label-blunder { border-color: #fa412d; color: #fa412d; }
</style>
