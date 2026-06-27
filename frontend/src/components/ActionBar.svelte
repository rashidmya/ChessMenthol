<script lang="ts">
  export let currentPly: number = 0;
  export let total: number = 0;
  export let onNavigate: (ply: number) => void = () => {};
</script>

<div class="actions">
  <button type="button" class="navbtn" title="First move"
    on:click={() => onNavigate(0)}>«</button>
  <button type="button" class="navbtn" title="Previous move"
    on:click={() => onNavigate(currentPly - 1)}>‹</button>
  <button type="button" class="navbtn" title="Next move"
    on:click={() => onNavigate(currentPly + 1)}>›</button>
  <button type="button" class="navbtn" title="Last move"
    on:click={() => onNavigate(total)}>»</button>
</div>

<style>
  .actions {
    display: flex; align-items: center; justify-content: center;
    gap: 8px; padding: 13px 16px;
  }
  .navbtn {
    display: grid; place-items: center; width: 48px; height: 36px;
    font-family: var(--serif); font-size: 22px; color: var(--ink-2);
    background: var(--paper-2); border: 1px solid var(--keyline-2); border-radius: 7px;
    cursor: pointer; transition: .15s; line-height: 1;
  }
  .navbtn:hover { border-color: var(--green); color: var(--green); background: #fff; }
</style>
