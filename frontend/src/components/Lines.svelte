<script lang="ts">
  import type { LineDto } from '../lib/types';
  import { toFigurine } from '../lib/figurine';
  export let lines: LineDto[] = [];
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
      <span class="pv">{toFigurine(l.san)}</span>
      <button
        class="lexp"
        title={open.has(l.multipv) ? 'Collapse line' : 'Show full line'}
        on:click={() => toggle(l.multipv)}
      >
        <svg class="ic-down" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M5.8 9.7L12 16l6.2-6.3c.2-.2.3-.5.3-.7s-.1-.5-.3-.7s-.4-.3-.7-.3h-11c-.3 0-.5.1-.7.3s-.3.4-.3.7s.1.5.3.7" /></svg>
        <svg class="ic-up" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M18.2 13.3L12 7l-6.2 6.3c-.2.2-.3.5-.3.7s.1.5.3.7s.4.3.7.3h11c.3 0 .5-.1.7-.3s.3-.5.3-.7s-.1-.5-.3-.7" /></svg>
      </button>
    </div>
  {/each}
</div>

<style>
  .lines { font-family: monospace; font-size: 12.5px; }
  .line { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 9px;
    padding: 6px 8px; font-family: monospace; font-size: 12.5px; cursor: default; }
  .line.open { align-items: start; }
  .line + .line { border-top: 1px solid rgba(224, 218, 203, 0.3); }
  .line .sc { justify-self: start; font-weight: 700; font-size: 11.5px;
    font-variant-numeric: tabular-nums; padding: 3px 7px; border-radius: 5px;
    min-width: 52px; text-align: center; }
  .line .pv { color: #a8a193; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .line.open .pv { white-space: normal; overflow: visible; text-overflow: clip; }
  .lexp { display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
    border: none; background: transparent; cursor: pointer; color: #a8a193; transition: .14s; }
  .lexp:hover { color: #3d7a4c; }
  .lexp svg { width: 15px; height: 15px; display: block; }
  .lexp .ic-up { display: none; }
  .line.open .lexp .ic-down { display: none; }
  .line.open .lexp .ic-up { display: block; }
  .line.pos .sc { background: #f7f4ec; color: #1b1916; border: 1px solid #cfc7b3; }
  .line.neg .sc { background: #2b2723; color: #f4f1ea; border: 1px solid #46413a; }
</style>
