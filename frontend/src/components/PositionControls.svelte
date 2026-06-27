<script lang="ts">
  import type { Command } from '../lib/types';
  export let editing: boolean = false;
  export let onCommand: (c: Command) => void = () => {};
  export let onToggleEdit: () => void = () => {};

  let fenInput = '';
</script>

<div class="group">
  <div class="glab">Position</div>
  <div class="row">
    <input class="fen" placeholder="paste FEN…" bind:value={fenInput} />
    <button type="button" class="btn"
      on:click={() => onCommand({ type: 'set_fen', fen: fenInput })}>Set</button>
  </div>
  <div class="row">
    <button type="button" class="btn" class:on={editing}
      on:click={onToggleEdit}>{editing ? 'Done' : 'Edit Board'}</button>
    <button type="button" class="btn"
      on:click={() => onCommand({ type: 'reset' })}>Reset Board</button>
  </div>
</div>

<style>
  .group { padding: 11px 16px; }
  .glab {
    font-family: var(--mono); font-size: 9.5px; letter-spacing: .16em;
    text-transform: uppercase; color: var(--ink-faint); margin-bottom: 9px;
    display: flex; align-items: center;
  }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .row + .row { margin-top: 8px; }
  .btn {
    font-family: var(--sans); font-weight: 600; font-size: 12px; color: var(--ink);
    background: var(--paper-2); border: 1px solid var(--keyline-2); padding: 8px 14px;
    border-radius: 6px; cursor: pointer; transition: .14s;
  }
  .btn:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .btn.on { background: var(--green); color: #fff; border-color: var(--green); }
  .fen {
    flex: 1; min-width: 150px; font-family: var(--mono); font-size: 11px; color: var(--ink);
    background: #fff; border: 1px solid var(--keyline-2); border-radius: 6px; padding: 8px 11px;
  }
  .fen::placeholder { color: var(--ink-faint); }
  .fen:focus { outline: none; border-color: var(--green); box-shadow: 0 0 0 3px rgba(47,93,58,.12); }
</style>
