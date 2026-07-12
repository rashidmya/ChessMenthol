<script lang="ts">
  import { settings, patchSettings } from '../../src/lib/settings';
  const TIMES = [2000, 5000, 10000];
  const s = settings;
  function stepLines(d: number) { patchSettings({ lines: Math.min(5, Math.max(1, $s.lines + d)) }); }
</script>

<div class="settings" data-testid="settings-panel">
  <div class="row">
    <span class="name">Lines</span>
    <span class="stepper">
      <button data-testid="lines-dec" on:click={() => stepLines(-1)} aria-label="fewer lines">−</button>
      <span class="num" data-testid="lines-value">{$s.lines}</span>
      <button data-testid="lines-inc" on:click={() => stepLines(1)} aria-label="more lines">+</button>
    </span>
  </div>

  <div class="row">
    <span class="name">Thinking time</span>
    <span class="seg">
      {#each TIMES as t}
        <button data-testid={`time-${t}`} class:on={$s.thinkingMs === t}
          on:click={() => patchSettings({ thinkingMs: t })}>{t / 1000}s</button>
      {/each}
    </span>
  </div>

  <label class="row"><span class="name">Auto-analyze</span>
    <input type="checkbox" data-testid="toggle-auto" checked={$s.autoAnalyze}
      on:change={() => patchSettings({ autoAnalyze: !$s.autoAnalyze })} /></label>

  <label class="row"><span class="name">Best-move arrows</span>
    <input type="checkbox" data-testid="toggle-arrows" checked={$s.arrows}
      on:change={() => patchSettings({ arrows: !$s.arrows })} /></label>

  <label class="row"><span class="name">Live site reading</span>
    <input type="checkbox" data-testid="toggle-live" checked={$s.liveSiteReading}
      on:change={() => patchSettings({ liveSiteReading: !$s.liveSiteReading })} /></label>
</div>

<style>
  .settings { display: flex; flex-direction: column; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 10px 4px;
    border-bottom: 1px solid rgba(255,255,255,.08); font-size: 13px; }
  .row:last-child { border-bottom: none; }
  .name { font-weight: 600; }
  .stepper { display: inline-flex; align-items: center; gap: 8px; }
  .stepper button { width: 24px; height: 24px; }
  .num { min-width: 16px; text-align: center; font-variant-numeric: tabular-nums; }
  .seg { display: inline-flex; gap: 4px; }
  .seg button { padding: 3px 9px; font-variant-numeric: tabular-nums; }
  .seg button.on { background: #3a6f4a; color: #fff; }
</style>
