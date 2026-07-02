<script lang="ts">
  import type { MoveEntryDto } from '../lib/types';
  import { moveColor } from '../lib/moveclass';
  import { tick } from 'svelte';
  import MoveBadge from './MoveBadge.svelte';

  export let moveList: MoveEntryDto[] = [];
  export let currentPly: number = 0;
  export let onNavigate: (ply: number) => void = () => {};
  // Prepend a quality badge before each classified move's SAN (used on the Review
  // screen). Off by default so the analysis-screen move list is unchanged.
  export let showBadges = false;

  let container: HTMLElement | undefined;

  type Row = { rowIdx: number; white: MoveEntryDto | null; black: MoveEntryDto | null };

  // Assumes `list` is ply-ascending (the backend guarantees moveList is ordered
  // by ply); we group by rowIdx without re-sorting.
  function buildRows(list: MoveEntryDto[]): Row[] {
    const map = new Map<number, Row>();
    for (const entry of list) {
      const rowIdx = Math.floor((entry.ply - 1) / 2);
      if (!map.has(rowIdx)) map.set(rowIdx, { rowIdx, white: null, black: null });
      const row = map.get(rowIdx)!;
      if (entry.ply % 2 === 1) row.white = entry;
      else row.black = entry;
    }
    return Array.from(map.values());
  }

  $: rows = buildRows(moveList);

  // Scroll the current move into view after the DOM updates.
  // el?.scrollIntoView?.() uses optional chaining so it silently no-ops in
  // jsdom (which does not implement scrollIntoView).
  function scrollToCurrent(_ply: number): void {
    tick().then(() => {
      const el = container?.querySelector<HTMLElement>('.mh-mv.current');
      el?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  $: scrollToCurrent(currentPly);
</script>

<div class="movehist-sec">
  <div class="movehist" bind:this={container}>
    {#each rows as row (row.rowIdx)}
      <div class="mh-row">
        <span class="mh-no">{row.rowIdx + 1}</span>
        {#if row.white}
          <button
            type="button"
            class="mh-mv"
            class:current={row.white.ply === currentPly}
            style:color={moveColor(row.white.classification)}
            aria-current={row.white.ply === currentPly ? 'true' : undefined}
            data-testid="mh-mv"
            on:click={() => onNavigate(row.white!.ply)}
          >{#if showBadges && row.white.classification}<MoveBadge label={row.white.classification.label} size={13} />{/if}{row.white.san}</button>
        {:else}
          <span class="mh-mv mh-empty">…</span>
        {/if}
        {#if row.black}
          <button
            type="button"
            class="mh-mv"
            class:current={row.black.ply === currentPly}
            style:color={moveColor(row.black.classification)}
            aria-current={row.black.ply === currentPly ? 'true' : undefined}
            data-testid="mh-mv"
            on:click={() => onNavigate(row.black!.ply)}
          >{#if showBadges && row.black.classification}<MoveBadge label={row.black.classification.label} size={13} />{/if}{row.black.san}</button>
        {:else}
          <span class="mh-mv mh-empty">…</span>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  /* move history list */
  .movehist-sec { flex: 1; min-height: 180px; display: flex; flex-direction: column; }
  .movehist { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 6px; }
  .mh-row { display: grid; grid-template-columns: 30px 1fr 1fr; align-items: center; }
  .mh-row:nth-child(odd) { background: rgba(40,30,15,.022); }
  .mh-no { font-family: var(--mono); font-size: 10.5px; color: var(--ink-faint); text-align: center; user-select: none; }
  .mh-mv { display: flex; align-items: center; gap: 3px;
    font-family: var(--figurine), 'Hanken Grotesk', sans-serif;
    font-weight: 600; font-size: 12.5px; color: var(--ink); background: transparent; border: none;
    text-align: left; padding: 5px 7px; border-radius: 5px; cursor: pointer; transition: .12s; }
  .mh-mv:hover { background: var(--paper); }
  .mh-mv.current { background: var(--keyline); font-weight: 800; }
  /* Quality color is applied inline via `style:color` (moveColor), sourced from
     glyphs.ts so the list matches the board badges. Only notable moves are
     tinted — ordinary/best moves stay neutral (--ink). */
  .mh-empty { color: var(--ink-faint); cursor: default; }
  .mh-empty:hover { background: transparent; }
</style>
