<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { isTauri } from '@tauri-apps/api/core';
  import { getCurrentWindow, type Window } from '@tauri-apps/api/window';
  import type { UnlistenFn } from '@tauri-apps/api/event';

  // Whether the OS window is maximized — drives the max/restore glyph + label.
  let maximized = false;
  let unlisten: UnlistenFn | null = null;

  // Every window op is best-effort: a rejected IPC promise (e.g. a missing
  // permission) is logged, never thrown into the UI. getCurrentWindow() is only
  // touched inside these handlers / onMount, so importing or rendering this
  // component outside Tauri (jsdom, plain browser) never reaches the IPC layer.
  function run(fn: (w: Window) => Promise<unknown>): void {
    if (!isTauri()) return;
    try {
      fn(getCurrentWindow()).catch((e) => console.error('[titlebar]', e));
    } catch (e) {
      console.error('[titlebar]', e);
    }
  }

  const minimize = () => run((w) => w.minimize());
  const toggleMax = () => run((w) => w.toggleMaximize());
  const close = () => run((w) => w.close());

  async function refreshMaximized(): Promise<void> {
    if (!isTauri()) return;
    try {
      maximized = await getCurrentWindow().isMaximized();
    } catch (e) {
      console.error('[titlebar]', e); // keep the previous glyph on failure
    }
  }

  onMount(() => {
    if (!isTauri()) return;
    // Reserve top padding for the fixed strip (see app.css `body.has-titlebar`).
    document.body.classList.add('has-titlebar');
    refreshMaximized();
    // Keep the glyph in sync when the OS maximizes/restores (snap, Super+Up, …).
    getCurrentWindow()
      .onResized(() => refreshMaximized())
      .then((fn) => { unlisten = fn; })
      .catch((e) => console.error('[titlebar]', e));
  });

  onDestroy(() => {
    if (unlisten) unlisten();
    document.body.classList.remove('has-titlebar');
  });
</script>

<div class="titlebar">
  <!-- Drag applies ONLY to the element carrying the attribute (Tauri v2), so the
       draggable area is this flex-filler; the control buttons sit outside it and
       stay clickable. Double-clicking the region maximizes (Tauri built-in). -->
  <div class="drag" data-tauri-drag-region></div>
  <div class="controls">
    <button type="button" class="tb-btn" data-testid="tb-minimize"
      aria-label="Minimize" title="Minimize" on:click={minimize}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M19 13H5v-2h14z" />
      </svg>
    </button>
    <button type="button" class="tb-btn" data-testid="tb-maximize"
      aria-label={maximized ? 'Restore' : 'Maximize'}
      title={maximized ? 'Restore' : 'Maximize'} on:click={toggleMax}>
      {#if maximized}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M4 8h4V4h12v12h-4v4H4V8m12 0v6h2V6h-8v2h6M6 12v6h8v-6H6Z" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M4 4h16v16H4zm2 4v10h12V8z" />
        </svg>
      {/if}
    </button>
    <button type="button" class="tb-btn close" data-testid="tb-close"
      aria-label="Close" title="Close" on:click={close}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M13.46 12L19 17.54V19h-1.46L12 13.46L6.46 19H5v-1.46L10.54 12L5 6.46V5h1.46L12 10.54L17.54 5H19v1.46z" />
      </svg>
    </button>
  </div>
</div>

<style>
  .titlebar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 34px;
    display: flex;
    align-items: stretch;
    z-index: 1000;
    background: transparent; /* the paper background shows through */
    user-select: none;
    -webkit-user-select: none;
  }
  .drag { flex: 1 1 auto; height: 100%; }
  .controls { display: flex; align-items: stretch; }
  .tb-btn {
    width: 46px;
    height: 34px;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-2, #46423a);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .tb-btn:hover { background: rgba(40, 30, 15, 0.10); }
  .tb-btn:active { background: rgba(40, 30, 15, 0.16); }
  .tb-btn.close:hover { background: #e11d2d; color: #fff; }
  .tb-btn.close:active { background: #b3121f; color: #fff; }
  .tb-btn svg { display: block; }
</style>
