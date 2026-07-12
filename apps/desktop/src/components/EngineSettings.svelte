<script lang="ts">
  import RangeSlider from './RangeSlider.svelte';
  import EngineList from './EngineList.svelte';
  import EngineOptions from './EngineOptions.svelte';
  import { SEARCH_TIMES, DEFAULT_SEARCH_INDEX } from '../lib/options';
  import type { Command } from '@chessmenthol/core/lib/types';

  export let engineId: string = 'stockfish';
  export let onCommand: (c: Command) => void = () => {};
  export let onSetEngine: (id: string) => void = () => {};

  let search = DEFAULT_SEARCH_INDEX;
</script>

<div class="set-col">
  <span class="k">Engine</span>
  <EngineList {engineId} {onSetEngine} />
</div>
<div class="set-row">
  <span class="k">Search time</span>
  <RangeSlider
    min={0} max={5} value={search} ariaLabel="Search time"
    labels={SEARCH_TIMES.map((s) => s.label)}
    onInput={(v) => { search = v; onCommand({ type: 'set_options', movetime: SEARCH_TIMES[v].ms }); }}
  />
</div>
<div class="set-col">
  <span class="k">Engine options</span>
  <EngineOptions {engineId} {onCommand} />
</div>

<style>
  .set-row { display: flex; align-items: center; gap: 10px; }
  .set-row .k { flex: none; width: 60px; font-family: var(--mono); font-size: 9.5px;
    letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); line-height: 1.25; }
  .set-col { display: flex; flex-direction: column; gap: 8px; }
  /* Column-layout label: same type treatment as .set-row .k, minus the fixed
     width/flex used for the horizontal row alignment. */
  .set-col .k { font-family: var(--mono); font-size: 9.5px;
    letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); line-height: 1.25; }
</style>
