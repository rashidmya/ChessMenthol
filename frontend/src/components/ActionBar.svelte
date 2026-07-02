<script lang="ts">
  import Icon from './Icon.svelte';
  import MoveStepper from './MoveStepper.svelte';
  export let currentPly: number = 0;
  export let total: number = 0;
  export let onNavigate: (ply: number) => void = () => {};
  export let onNew: () => void = () => {};
  export let onRequestAnalysis: () => void = () => {};
  export let onCancelAnalysis: () => void = () => {};
  export let reportProgress: { done: number; total: number } | null = null;
  export let hasReportForGame: boolean = false;

  $: pct = reportProgress ? Math.round((reportProgress.done / (reportProgress.total || 1)) * 100) : 0;
</script>

<MoveStepper {currentPly} {total} {onNavigate} />

{#if reportProgress}
  <div class="analyzing" data-testid="analysis-progress">
    <div class="bar"><div class="fill" style="width:{pct}%"></div></div>
    <button type="button" class="cancel" on:click={onCancelAnalysis}>Cancel · {reportProgress.done}/{reportProgress.total}</button>
  </div>
{/if}

<div class="acts">
  {#if !reportProgress}
    <button type="button" class="act" data-testid="request-analysis"
      disabled={total === 0} on:click={onRequestAnalysis}>
      <span class="ic"><Icon name="BarChart" /></span>{hasReportForGame ? 'View game report' : 'Request computer analysis'}
    </button>
  {/if}
  <button type="button" class="act" on:click={onNew}><span class="ic"><Icon name="Reload" /></span>New</button>
</div>

<style>
  .analyzing { display: flex; flex-direction: column; gap: 8px; padding: 2px 16px 6px; }
  .bar { height: 8px; border-radius: 5px; background: var(--keyline); overflow: hidden; }
  .fill { height: 100%; background: var(--green); transition: width .2s; }
  .cancel { align-self: center; padding: 6px 12px; border: 1px solid var(--keyline-2); border-radius: 7px;
    background: var(--paper-2); font-family: var(--mono); font-size: 11px; color: var(--ink-2); cursor: pointer; }
  .acts { display: flex; justify-content: center; gap: 8px; padding: 4px 12px 14px; }
  .act {
    display: flex; align-items: center; gap: 8px; padding: 10px 18px;
    font-family: var(--sans); font-weight: 600; font-size: 13.5px; color: var(--ink-2);
    background: transparent; border: none; border-radius: 9px; cursor: pointer; transition: .14s;
  }
  .act:hover:not(:disabled) { color: var(--green); background: var(--paper-2); }
  .act:disabled { color: var(--ink-faint); cursor: default; }
  .act .ic { font-size: 15px; }
</style>
