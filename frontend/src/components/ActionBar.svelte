<script lang="ts">
  import Icon from './Icon.svelte';
  export let currentPly: number = 0;
  export let total: number = 0;
  export let onNavigate: (ply: number) => void = () => {};
  export let onNew: () => void = () => {};
</script>

<div class="nav">
  <button type="button" class="navbtn" title="First move"
    on:click={() => onNavigate(0)}><Icon name="JumpFirst" /></button>
  <button type="button" class="navbtn" title="Previous move"
    on:click={() => onNavigate(currentPly - 1)}><Icon name="JumpPrev" /></button>
  <button type="button" class="navbtn" title="Next move"
    on:click={() => onNavigate(currentPly + 1)}><Icon name="JumpNext" /></button>
  <button type="button" class="navbtn" title="Last move"
    on:click={() => onNavigate(total)}><Icon name="JumpLast" /></button>
</div>
<div class="acts">
  <button type="button" class="act" on:click={onNew}><span class="ic"><Icon name="Reload" /></span>New</button>
</div>

<style>
  .nav { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
  .navbtn {
    flex: 1; display: grid; place-items: center; height: 50px;
    font-family: var(--serif); font-size: 24px; color: var(--ink-2);
    background: var(--paper-2); border: 1px solid var(--keyline-2); border-radius: 10px;
    cursor: pointer; transition: .15s; line-height: 1;
  }
  .navbtn:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .acts { display: flex; justify-content: center; padding: 4px 12px 14px; }
  .act {
    display: flex; align-items: center; gap: 8px; padding: 10px 18px;
    font-family: var(--sans); font-weight: 600; font-size: 13.5px; color: var(--ink-2);
    background: transparent; border: none; border-radius: 9px; cursor: pointer; transition: .14s;
  }
  .act:hover { color: var(--green); background: var(--paper-2); }
  .act .ic { font-size: 15px; }
</style>
