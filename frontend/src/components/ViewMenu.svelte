<script lang="ts">
  import Switch from './Switch.svelte';

  export let prefs: { evalBar: boolean; lines: boolean; arrows: boolean; feedback: boolean } =
    { evalBar: true, lines: true, arrows: true, feedback: true };
  export let onToggle: (key: 'evalBar' | 'lines' | 'arrows' | 'feedback') => void = () => {};
</script>

<div class="menu-row">
  <span class="mk">Evaluation Bar</span>
  <Switch on={prefs.evalBar} label="Evaluation Bar" onToggle={() => onToggle('evalBar')} />
</div>
<div class="menu-row">
  <span class="mk">Engine Lines</span>
  <Switch on={prefs.lines} label="Engine Lines" onToggle={() => onToggle('lines')} />
</div>
<div class="menu-row">
  <span class="mk">Suggestion Arrows</span>
  <Switch on={prefs.arrows} label="Suggestion Arrows" onToggle={() => onToggle('arrows')} />
</div>
<div class="menu-row">
  <span class="mk">Move Feedback</span>
  <Switch on={prefs.feedback} label="Move Feedback" onToggle={() => onToggle('feedback')} />
</div>

<style>
  .menu-row { display: flex; align-items: center; gap: 14px; padding: 8px 4px;
    cursor: pointer; border-radius: 5px; }
  .menu-row:hover { background: var(--paper); }
  .menu-row .mk { flex: 1; font-family: var(--sans); font-weight: 600;
    font-size: 12.5px; color: var(--ink-2); }
</style>
