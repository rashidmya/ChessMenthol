<script lang="ts">
  import { isTauri } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  // @tauri-apps/api/window declares ResizeDirection but does not export it; this
  // identical string-union is structurally assignable to startResizeDragging's arg.
  type ResizeDirection =
    | 'North' | 'South' | 'East' | 'West'
    | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

  // A frameless window (decorations:false) loses the OS resize borders, so we lay
  // thin invisible grips over the window's edges and corners; each starts a native
  // resize drag in its direction via getCurrentWindow().startResizeDragging(). All
  // Tauri access is guarded by isTauri() so the component is inert in a plain
  // browser / jsdom (getCurrentWindow() is only touched inside the handler).
  const GRIPS: { dir: ResizeDirection; cls: string }[] = [
    { dir: 'North', cls: 'n' },  { dir: 'South', cls: 's' },
    { dir: 'West', cls: 'w' },   { dir: 'East', cls: 'e' },
    { dir: 'NorthWest', cls: 'nw' }, { dir: 'NorthEast', cls: 'ne' },
    { dir: 'SouthWest', cls: 'sw' }, { dir: 'SouthEast', cls: 'se' },
  ];

  function startResize(dir: ResizeDirection, e: MouseEvent): void {
    if (!isTauri() || e.button !== 0) return; // primary button only
    try {
      getCurrentWindow().startResizeDragging(dir).catch((err) => console.error('[resize]', err));
    } catch (err) {
      console.error('[resize]', err);
    }
  }
</script>

<div class="resize-grips" aria-hidden="true">
  {#each GRIPS as g}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="grip {g.cls}" data-testid={`resize-${g.cls}`}
      on:mousedown={(e) => startResize(g.dir, e)}></div>
  {/each}
</div>

<style>
  .resize-grips { --grip: 6px; --corner: 13px; }
  .grip { position: fixed; z-index: 1500; }
  /* edges */
  .grip.n { top: 0; left: 0; right: 0; height: var(--grip); cursor: ns-resize; }
  .grip.s { bottom: 0; left: 0; right: 0; height: var(--grip); cursor: ns-resize; }
  .grip.w { top: 0; bottom: 0; left: 0; width: var(--grip); cursor: ew-resize; }
  .grip.e { top: 0; bottom: 0; right: 0; width: var(--grip); cursor: ew-resize; }
  /* corners sit above the edges so diagonal resize wins in the corner */
  .grip.nw, .grip.ne, .grip.sw, .grip.se { width: var(--corner); height: var(--corner); z-index: 1501; }
  .grip.nw { top: 0; left: 0; cursor: nwse-resize; }
  .grip.ne { top: 0; right: 0; cursor: nesw-resize; }
  .grip.sw { bottom: 0; left: 0; cursor: nesw-resize; }
  .grip.se { bottom: 0; right: 0; cursor: nwse-resize; }
</style>
