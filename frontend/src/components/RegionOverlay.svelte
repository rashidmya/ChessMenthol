<script lang="ts">
  import type { RegionShotFrame } from '../lib/types';
  import { toDesktopRegion, type Region } from '../lib/region';
  import Icon from './Icon.svelte';
  export let shot: RegionShotFrame | null = null;
  export let onConfirm: (r: Region) => void = () => {};
  export let onCancel: () => void = () => {};

  let img: HTMLImageElement;
  let dragging = false;
  let sx = 0, sy = 0;            // start, in image-displayed px
  let box = { x: 0, y: 0, w: 0, h: 0 };
  let hasBox = false;

  function localXY(e: MouseEvent) {
    const r = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - r.left, r.width)),
      y: Math.max(0, Math.min(e.clientY - r.top, r.height)),
    };
  }
  function onDown(e: MouseEvent) {
    const p = localXY(e); sx = p.x; sy = p.y;
    box = { x: sx, y: sy, w: 0, h: 0 }; dragging = true; hasBox = true;
  }
  function onMove(e: MouseEvent) {
    if (!dragging) return;
    const p = localXY(e); box = { x: sx, y: sy, w: p.x - sx, h: p.y - sy };
  }
  function onUp() { dragging = false; }
  function confirmRegion() {
    if (!shot || !hasBox || selW === 0 || selH === 0) { onCancel(); return; }
    // The <img> ELEMENT box can be larger than the *painted* image: with
    // object-fit:contain inside a flex container the element is stretched, so
    // clientWidth/Height include letterbox padding. Map the drag box relative to
    // the painted-image rect (from naturalWidth/Height), not the element box, so
    // the desktop scale is correct on every webview engine.
    const r = img.getBoundingClientRect();
    const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const paintedW = img.naturalWidth * scale;
    const paintedH = img.naturalHeight * scale;
    const offX = (r.width - paintedW) / 2;
    const offY = (r.height - paintedH) / 2;
    const region = toDesktopRegion(
      { x: box.x - offX, y: box.y - offY, w: box.w, h: box.h },
      { width: paintedW, height: paintedH },
      { width: shot.width, height: shot.height },
    );
    onConfirm(region);
  }
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }

  // Normalized selection rectangle in displayed px for the visual highlight.
  $: selL = Math.min(box.x, box.x + box.w);
  $: selT = Math.min(box.y, box.y + box.h);
  $: selW = Math.abs(box.w);
  $: selH = Math.abs(box.h);
</script>

<svelte:window on:mousemove={onMove} on:mouseup={onUp} on:keydown={onKey} />

<div class="overlay" data-testid="region-overlay">
  <div class="bar">
    <span><Icon name="Target" /> Drag a box over the chess board</span>
    <button data-testid="overlay-use" on:click={confirmRegion}>Use region</button>
    <button data-testid="overlay-cancel" class="ghost" on:click={onCancel}>Cancel</button>
  </div>
  {#if shot}
    <div class="stage">
      <img role="presentation" data-testid="overlay-img" bind:this={img} alt="screen"
        src={`data:image/jpeg;base64,${shot.jpegBase64}`} on:mousedown|preventDefault={onDown} />
      {#if hasBox}
        <div class="sel" style={`left:${selL}px;top:${selT}px;width:${selW}px;height:${selH}px`}></div>
      {/if}
    </div>
  {:else}
    <div class="capturing" data-testid="overlay-capturing">capturing…</div>
  {/if}
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 50; background: #0b0c0f;
    display: flex; flex-direction: column; align-items: center; }
  .bar { display: flex; gap: 10px; align-items: center; padding: 8px 12px; color: #e8e8e8;
    font: 12px system-ui; width: 100%; box-sizing: border-box; background: #1b1e24; }
  .bar button { margin-left: auto; font: 12px system-ui; padding: 5px 12px; border-radius: 6px;
    cursor: pointer; background: #11a26b; border: 1px solid #11a26b; color: #04150e; font-weight: 600; }
  .bar button.ghost { margin-left: 0; background: #23262d; border-color: #3a3d44; color: #e8e8e8; }
  .stage { position: relative; flex: 1; display: flex; min-height: 0; cursor: crosshair; }
  img { max-width: 100vw; max-height: calc(100vh - 40px); object-fit: contain; user-select: none; }
  .sel { position: absolute; border: 2px solid #11a26b; background: rgba(17,162,107,0.18);
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.55); pointer-events: none; }
  .capturing { color: #aaa; font: 13px system-ui; margin: auto; }
</style>
