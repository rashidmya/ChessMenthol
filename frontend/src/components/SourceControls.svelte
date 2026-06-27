<script lang="ts">
  import type { Command } from '../lib/types';
  export let region: { left: number; top: number; width: number; height: number } | null = null;
  export let visionStatus: string = 'idle';
  export let lowConfidence: string[] = [];
  export let onCommand: (c: Command) => void = () => {};
  export let onPickRegion: () => void = () => {};

  $: statusText =
    visionStatus === 'no_board' ? 'Board Undetected' :
    visionStatus === 'low_confidence' ? `${lowConfidence.length} uncertain` :
    '';
</script>

<div class="group">
  <div class="glab">Source <span class="status">{statusText}</span></div>
  <div class="row">
    <button type="button" class="btn solid" disabled={region == null}
      on:click={() => onCommand({ type: 'capture_now' })}>Capture Board</button>
    <button type="button" class="btn"
      on:click={onPickRegion}>Select Region</button>
    <button type="button" class="btn"
      on:click={() => onCommand({ type: 'clear_region' })}>Clear Selection</button>
  </div>
</div>

<style>
  .group { padding: 11px 16px; }
  .glab {
    font-family: var(--mono); font-size: 9.5px; letter-spacing: .16em;
    text-transform: uppercase; color: var(--ink-faint); margin-bottom: 9px;
    display: flex; align-items: center;
  }
  .glab .status {
    margin-left: auto; color: var(--ink-faint); font-weight: 600;
    text-transform: none; letter-spacing: .03em;
  }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .btn {
    font-family: var(--sans); font-weight: 600; font-size: 12px; color: var(--ink);
    background: var(--paper-2); border: 1px solid var(--keyline-2); padding: 8px 14px;
    border-radius: 6px; cursor: pointer; transition: .14s;
  }
  .btn:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .btn.solid { background: var(--green); color: #fff; border-color: var(--green); }
  .btn.solid:hover { background: var(--green-soft); color: #fff; }
  .btn:disabled, .btn.solid:disabled {
    background: var(--paper-2); color: var(--ink-faint);
    border-color: var(--keyline-2); cursor: not-allowed;
  }
  .btn:disabled:hover, .btn.solid:disabled:hover {
    background: var(--paper-2); color: var(--ink-faint); border-color: var(--keyline-2);
  }
</style>
