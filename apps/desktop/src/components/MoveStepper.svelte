<script lang="ts">
  import Icon from './Icon.svelte';
  export let currentPly: number = 0;
  export let total: number = 0;
  export let onNavigate: (ply: number) => void = () => {};
  // When onTogglePlay is provided, a play/pause button appears between prev and next.
  export let playing: boolean = false;
  export let onTogglePlay: (() => void) | null = null;
  // Compact, flat variant used in the mobile under-board control row.
  export let compact = false;
</script>

<div class="nav" class:compact>
  <button type="button" class="navbtn" title="First move"
    on:click={() => onNavigate(0)}><Icon name="JumpFirst" /></button>
  <button type="button" class="navbtn" title="Previous move"
    on:click={() => onNavigate(currentPly - 1)}><Icon name="JumpPrev" /></button>
  {#if onTogglePlay}
    <button type="button" class="navbtn play" data-testid="autoplay"
      title={playing ? 'Pause' : 'Auto-play'} on:click={onTogglePlay}>
      <Icon name={playing ? 'Pause' : 'PlayTriangle'} />
    </button>
  {/if}
  <button type="button" class="navbtn" title="Next move"
    on:click={() => onNavigate(currentPly + 1)}><Icon name="JumpNext" /></button>
  <button type="button" class="navbtn" title="Last move"
    on:click={() => onNavigate(total)}><Icon name="JumpLast" /></button>
</div>

<style>
  .nav { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
  .navbtn {
    flex: 1; display: grid; place-items: center; height: 50px;
    font-family: var(--serif); font-size: 24px; color: var(--ink-2);
    background: var(--btn); border: 1px solid var(--keyline-2); border-radius: 10px;
    cursor: pointer; transition: .15s; line-height: 1;
  }
  .navbtn:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .navbtn.play { color: var(--green); }

  .nav.compact { gap: 4px; padding: 0; }
  .nav.compact .navbtn {
    flex: 0 0 auto; width: 33px; height: 33px;
    font-size: 18px; background: transparent; border: none; border-radius: 8px;
  }
  .nav.compact .navbtn:hover { background: transparent; color: var(--green); }
  @media (pointer: coarse) { .nav.compact .navbtn { min-width: 40px; min-height: 40px; } }
</style>
