<script lang="ts">
  import { onMount } from 'svelte';
  import Switch from './Switch.svelte';
  import EngineSettings from './EngineSettings.svelte';
  import ViewMenu from './ViewMenu.svelte';
  import { engineName } from '../lib/engineRegistry';
  import type { Command } from '../lib/types';

  export let analysisEnabled: boolean = false;
  // Draw the header's bottom divider only when there are engine lines directly
  // below it inside the same card section; otherwise it dangles as a stray line
  // (e.g. when analysis is off, the lines block is gone).
  export let divider: boolean = false;
  export let analyzing: boolean = false;
  export let depth: number = 0;
  export let engineId: string = 'stockfish';
  export let onCommand: (c: Command) => void = () => {};
  export let onSetEngine: (id: string) => void = () => {};
  export let prefs: { evalBar: boolean; lines: boolean; arrows: boolean; feedback: boolean } =
    { evalBar: true, lines: true, arrows: true, feedback: true };
  export let onToggle: (key: 'evalBar' | 'lines' | 'arrows' | 'feedback') => void = () => {};

  let open: 'cog' | 'menu' | null = null;

  onMount(() => {
    const h = () => (open = null);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  });

  // The View-options menu only exists while analysis is on; if analysis turns off
  // while a popover is open, close it so it can't reappear open on re-enable.
  $: if (!analysisEnabled) open = null;

  // Reserved for F10 (live-analysis indicator); suppresses the unused-prop reactive-statement lint.
  $: void analyzing;
</script>

<div class="hd" class:divider>
  <div class="swwrap">
    <span class="txt">Analysis</span>
    <Switch
      on={analysisEnabled}
      label="Analysis"
      onToggle={() => onCommand({ type: 'set_analysis_enabled', enabled: !analysisEnabled })}
    />
  </div>
  <span class="tag">depth {depth}<span class="bar">|</span><span class="eng">{engineName(engineId)}</span></span>
  <button
    class="cog"
    class:on={open === 'cog'}
    aria-label="Engine settings"
    on:click|stopPropagation={() => (open = open === 'cog' ? null : 'cog')}
  >&#9881;</button>
  {#if analysisEnabled}
    <button
      class="cog"
      class:on={open === 'menu'}
      aria-label="View options"
      on:click|stopPropagation={() => (open = open === 'menu' ? null : 'menu')}
    >&#9776;</button>
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="settings" class:open={open === 'cog'} on:click|stopPropagation on:keydown|stopPropagation>
    <EngineSettings {engineId} {onCommand} {onSetEngine} />
  </div>
  {#if analysisEnabled}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="settings menu" class:open={open === 'menu'} on:click|stopPropagation on:keydown|stopPropagation>
      <ViewMenu {prefs} {onToggle} />
    </div>
  {/if}
</div>

<style>
  .hd { display: flex; align-items: center; gap: 8px; padding: 9px 14px 9px 16px;
    position: relative; }
  .hd.divider { border-bottom: 1px solid var(--keyline); }
  .hd .tag { margin-left: auto; font-family: var(--mono); font-size: 9.5px;
    letter-spacing: .06em; color: var(--ink-3); text-transform: uppercase; white-space: nowrap; }
  .hd .tag .bar { color: var(--keyline-2); margin: 0 3px; }
  .hd .tag .eng { color: var(--ink-2); font-weight: 700; }
  .swwrap { display: flex; align-items: center; gap: 10px; }
  .swwrap .txt { font-family: var(--mono); font-size: 9.5px; letter-spacing: .06em;
    text-transform: uppercase; color: var(--ink-2); font-weight: 700; }
  .cog { flex: none; width: 24px; height: 24px; display: grid; place-items: center;
    border: 1px solid var(--keyline-2); background: var(--paper-2); border-radius: 6px;
    cursor: pointer; color: var(--ink-3); font-size: 13px; line-height: 1; transition: .14s; }
  .cog:hover, .cog.on { border-color: var(--green); color: var(--green); background: #fff; }
  .settings { position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 30;
    background: var(--card); border: 1px solid var(--keyline-2); border-radius: 9px;
    padding: 12px 14px; box-shadow: 0 18px 44px -18px rgba(40,30,15,.55);
    display: none; flex-direction: column; gap: 11px; }
  .settings.open { display: flex; animation: rise .16s ease both; }
  .settings.menu { gap: 2px; }
  @keyframes rise { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
</style>
