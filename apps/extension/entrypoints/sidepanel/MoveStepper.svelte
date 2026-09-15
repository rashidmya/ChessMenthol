<script lang="ts">
  import Icon from './components/Icon.svelte';
  export let currentPly = 0;
  export let total = 0;
  export let onNavigate: (ply: number) => void = () => {};
  $: atStart = currentPly <= 0;
  $: atEnd = currentPly >= total;
</script>

<div class="nav" data-testid="move-stepper">
  <button type="button" class="navbtn" title="First move" aria-label="First move" disabled={atStart}
    on:click={() => onNavigate(0)}><Icon name="JumpFirst" /></button>
  <button type="button" class="navbtn" title="Previous move (undo)" aria-label="Previous move" disabled={atStart}
    on:click={() => onNavigate(currentPly - 1)}><Icon name="JumpPrev" /></button>
  <button type="button" class="navbtn" title="Next move" aria-label="Next move" disabled={atEnd}
    on:click={() => onNavigate(currentPly + 1)}><Icon name="JumpNext" /></button>
  <button type="button" class="navbtn" title="Last move" aria-label="Last move" disabled={atEnd}
    on:click={() => onNavigate(total)}><Icon name="JumpLast" /></button>
</div>

<style>
  .nav { display: flex; align-items: center; gap: 4px; }
  .navbtn {
    flex: 1; display: grid; place-items: center; height: 30px; font-size: 18px; line-height: 1;
    color: inherit; background: transparent; border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 6px; cursor: pointer;
  }
  .navbtn:hover:not(:disabled) { border-color: color-mix(in srgb, currentColor 35%, transparent); }
  .navbtn:disabled { opacity: .35; cursor: default; }
</style>
