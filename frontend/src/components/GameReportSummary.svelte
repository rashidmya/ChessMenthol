<script lang="ts">
  import Icon from './Icon.svelte';
  import MoveBadge from './MoveBadge.svelte';
  import type { GameReportDto } from '../lib/types';

  export let report: GameReportDto;
  export let onStartReview: () => void = () => {};
  export let onBackToAnalysis: () => void = () => {};
  export let onNew: () => void = () => {};

  // Count keys double as the MoveBadge label (same MoveClass strings). Display order
  // matches the reference screenshot.
  type CatKey = 'brilliant' | 'great' | 'book' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';
  const CATS: { key: CatKey; label: string }[] = [
    { key: 'brilliant', label: 'Brilliant' }, { key: 'great', label: 'Great' },
    { key: 'book', label: 'Book' }, { key: 'best', label: 'Best' },
    { key: 'excellent', label: 'Excellent' }, { key: 'good', label: 'Good' },
    { key: 'inaccuracy', label: 'Inaccuracy' }, { key: 'mistake', label: 'Mistake' },
    { key: 'miss', label: 'Miss' }, { key: 'blunder', label: 'Blunder' },
  ];
</script>

<div class="card" data-testid="report-panel">
  <header class="ghead">
    <span class="medal"><Icon name="Trophy" /></span>
    <span class="gtitle">Game Review</span>
    <button type="button" class="toanalysis" data-testid="report-to-analysis"
      title="Back to analysis" aria-label="Back to analysis" on:click={onBackToAnalysis}><Icon name="Microscope" /></button>
  </header>

  <div class="players">
    <div class="pl"><span class="avatar white"></span><span class="pname">{report.whiteName ?? 'White'}</span>
      <span class="acc" data-testid="acc-white">{report.white.accuracy}</span></div>
    <div class="mid"><span class="albl">Accuracy</span></div>
    <div class="pl"><span class="avatar black"></span><span class="pname">{report.blackName ?? 'Black'}</span>
      <span class="acc" data-testid="acc-black">{report.black.accuracy}</span></div>
  </div>

  <div class="cats">
    {#each CATS as c (c.key)}
      <div class="crow" data-testid="cat-{c.key}">
        <span class="cnt">{report.white[c.key]}</span>
        <span class="cmid"><MoveBadge label={c.key} size={18} /><span class="clabel">{c.label}</span></span>
        <span class="cnt">{report.black[c.key]}</span>
      </div>
    {/each}
  </div>

  <div class="gacts">
    <button type="button" class="new" on:click={onNew}>New</button>
    <button type="button" class="review" data-testid="start-review" on:click={onStartReview}>Start Review</button>
  </div>
</div>

<style>
  .card {
    background: var(--card); border: 1px solid var(--keyline); border-radius: 8px;
    box-shadow: 0 1px 0 #fff inset, 0 12px 30px -24px rgba(40,30,15,.45);
    display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto;
  }
  .ghead { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
    padding: 12px 15px; border-bottom: 1px solid var(--keyline); }
  .medal { color: var(--green); font-size: 18px; justify-self: start; }
  .gtitle { font-family: var(--sans); font-weight: 800; font-size: 15px; color: var(--ink); text-align: center; }
  .toanalysis { justify-self: end; width: 30px; height: 30px; display: grid; place-items: center;
    border: 1px solid var(--keyline-2); border-radius: 7px; background: var(--paper-2);
    color: var(--ink-2); font-size: 15px; cursor: pointer; }
  .toanalysis:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .players { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
    padding: 14px 16px; border-bottom: 1px solid var(--keyline); }
  .pl { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .avatar { width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--keyline-2); }
  .avatar.white { background: #f7f3ea; } .avatar.black { background: #2b2823; }
  .pname { font-family: var(--sans); font-weight: 600; font-size: 12.5px; color: var(--ink); }
  .acc { font-family: var(--mono); font-weight: 700; font-size: 16px; color: var(--ink);
    background: var(--paper-2); border: 1px solid var(--keyline-2); border-radius: 6px; padding: 2px 12px; }
  .albl { font-family: var(--mono); font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); }
  .cats { padding: 6px 10px; }
  .crow { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 6px 8px; }
  .crow:nth-child(odd) { background: rgba(40,30,15,.022); }
  .cnt { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink-2); text-align: center; }
  .cmid { display: flex; align-items: center; gap: 8px; justify-content: flex-start; padding-left: 18px; }
  .clabel { font-family: var(--sans); font-size: 13px; color: var(--ink); }
  .gacts { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-top: 1px solid var(--keyline); }
  .new { padding: 9px 16px; border: 1px solid var(--keyline-2); border-radius: 8px; background: var(--paper-2);
    font-family: var(--sans); font-weight: 600; font-size: 13px; color: var(--ink-2); cursor: pointer; }
  .new:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .review { padding: 12px 16px; border: none; border-radius: 9px; background: var(--green);
    font-family: var(--sans); font-weight: 800; font-size: 15px; color: #fff; cursor: pointer; }
  .review:hover { filter: brightness(1.05); }
</style>
