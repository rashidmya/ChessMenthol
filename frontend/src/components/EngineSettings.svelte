<script lang="ts">
  import RangeSlider from './RangeSlider.svelte';
  import { ENGINES, MEMORY_MB, SEARCH_TIMES } from '../lib/options';
  import type { Command } from '../lib/types';

  export let engineId: string = 'stockfish';
  export let onCommand: (c: Command) => void = () => {};
  export let onSetEngine: (id: string) => void = () => {};

  // Note: Lines min is 1 (not the mockup's 0) because multipv must be ≥1 or the
  // engine rejects it. Hiding engine lines is the ViewMenu "Engine Lines" toggle's job.
  let lines = 3;
  let search = 2;
  let threads = 4;
  let mem = 4;
</script>

<div class="set-row">
  <span class="k">Engine</span>
  <select class="sel" on:change={(e) => onSetEngine((e.target as HTMLSelectElement).value)}>
    {#each ENGINES as eng}
      <option value={eng.id} selected={eng.id === engineId}>{eng.label}</option>
    {/each}
  </select>
</div>
<div class="set-row">
  <span class="k">Lines</span>
  <RangeSlider
    min={1} max={5} value={lines} ariaLabel="Lines"
    onInput={(v) => { lines = v; onCommand({ type: 'set_options', multipv: v }); }}
  />
</div>
<div class="set-row">
  <span class="k">Search time</span>
  <RangeSlider
    min={0} max={5} value={search} ariaLabel="Search time"
    labels={SEARCH_TIMES.map((s) => s.label)}
    onInput={(v) => { search = v; onCommand({ type: 'set_options', movetime: SEARCH_TIMES[v].ms }); }}
  />
</div>
<div class="set-row">
  <span class="k">Threads</span>
  <RangeSlider
    min={2} max={32} value={threads} ariaLabel="Threads"
    onInput={(v) => { threads = v; onCommand({ type: 'set_options', threads: v }); }}
  />
</div>
<div class="set-row">
  <span class="k">Memory</span>
  <RangeSlider
    min={0} max={5} value={mem} ariaLabel="Memory"
    labels={MEMORY_MB.map((m) => `${m}MB`)}
    onInput={(v) => { mem = v; onCommand({ type: 'set_options', hash: MEMORY_MB[v] }); }}
  />
</div>

<style>
  .set-row { display: flex; align-items: center; gap: 10px; }
  .set-row .k { flex: none; width: 60px; font-family: var(--mono); font-size: 9.5px;
    letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); line-height: 1.25; }
  .set-row .sel { flex: 1; font-family: var(--sans); font-weight: 600; font-size: 12px;
    color: var(--ink); background: var(--paper-2); border: 1px solid var(--keyline-2);
    border-radius: 6px; padding: 8px 11px; cursor: pointer; }
</style>
