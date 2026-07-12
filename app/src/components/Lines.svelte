<script lang="ts">
  import type { LineDto } from '@chessmenthol/core/lib/types';
  import Icon from './Icon.svelte';
  export let lines: LineDto[] = [];
  // Per-multipv expand state. Resetting expansion across positions is the
  // parent's job, not ours: F10 keys <Lines> by FEN so a new position remounts
  // this component (and clears `open`). We deliberately do NOT reset per tick —
  // that would flicker open rows shut on every analysis update.
  let open = new Set<number>();
  function toggle(mpv: number) { open.has(mpv) ? open.delete(mpv) : open.add(mpv); open = open; }
  // White-better => positive pill; mate>0 also White-better.
  const sign = (l: LineDto) => (l.mate != null ? l.mate > 0 : (l.cp ?? 0) >= 0);
</script>

<div class="lines" data-testid="lines">
  {#each lines as l (l.multipv)}
    <div
      class="line {sign(l) ? 'pos' : 'neg'}"
      class:open={open.has(l.multipv)}
      data-testid="line-row"
    >
      <span class="sc">{l.scoreText}</span>
      <span class="pv">{l.san}</span>
      <button
        class="lexp"
        title={open.has(l.multipv) ? 'Collapse line' : 'Show full line'}
        on:click={() => toggle(l.multipv)}
      >
        <Icon name={open.has(l.multipv) ? 'UpTriangle' : 'DownTriangle'} />
      </button>
    </div>
  {/each}
</div>

<style>
  .line { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 9px;
    padding: 6px 8px; font-family: monospace; font-size: 12.5px; cursor: default; }
  .line.open { align-items: start; }
  .line + .line { border-top: 1px solid rgba(224, 218, 203, 0.3); }
  .line .sc { justify-self: start; font-weight: 700; font-size: 11.5px;
    font-variant-numeric: tabular-nums; padding: 3px 7px; border-radius: 5px;
    min-width: 52px; text-align: center; }
  .line .pv { font-family: var(--figurine), monospace; color: #a8a193;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .line.open .pv { white-space: normal; overflow: visible; text-overflow: clip; }
  .lexp { display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
    border: none; background: transparent; cursor: pointer; color: #a8a193;
    font-size: 15px; transition: .14s; }
  .lexp:hover { color: #3d7a4c; }
  .line.pos .sc { background: #f7f4ec; color: #1b1916; border: 1px solid #cfc7b3; }
  .line.neg .sc { background: #2b2723; color: #f4f1ea; border: 1px solid #46413a; }
</style>
