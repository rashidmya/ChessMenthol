<script lang="ts">
  import { tick } from 'svelte';
  import type { MoveEntryDto } from '@chessmenthol/core/lib/types';
  import MoveBadge from './components/MoveBadge.svelte';

  export let moveList: MoveEntryDto[] = [];
  export let currentPly = 0;
  export let onNavigate: (ply: number) => void = () => {};

  let el: HTMLElement | undefined;

  // Keep the current move in view after the DOM updates. Optional chaining on
  // scrollIntoView so it silently no-ops in jsdom.
  $: scrollToCurrent(currentPly);
  function scrollToCurrent(_ply: number): void {
    tick().then(() => el?.querySelector<HTMLElement>('.mv.current')?.scrollIntoView?.({ block: 'nearest' }));
  }
</script>

<div class="movelist" data-testid="move-list" bind:this={el}>
  {#each moveList as m (m.ply)}
    {#if m.ply % 2 === 1}<span class="num">{(m.ply + 1) / 2}.</span>{/if}
    <button type="button" class="mv" class:current={m.ply === currentPly}
      aria-current={m.ply === currentPly ? 'true' : undefined}
      data-testid="move-{m.ply}" on:click={() => onNavigate(m.ply)}>
      {#if m.classification}<MoveBadge label={m.classification.label} size={13} />{/if}{m.san}
    </button>
  {/each}
</div>

<style>
  .movelist { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px;
    max-height: 66px; overflow-y: auto; font-size: 12px; }
  .num { opacity: .55; margin-left: 4px; }
  .mv { display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px; border-radius: 4px;
    background: transparent; border: none; color: inherit; font: inherit; cursor: pointer; }
  .mv:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
  .mv.current { background: color-mix(in srgb, currentColor 16%, transparent); font-weight: 700; }
</style>
