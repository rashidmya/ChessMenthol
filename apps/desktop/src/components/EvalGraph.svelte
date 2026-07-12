<script lang="ts">
  import { moveColor } from '../lib/moveclass';
  import type { ClassificationDto } from '@chessmenthol/core/lib/types';

  export let wins: number[] = [];         // White-POV win% per position (index 0 = base)
  export let evals: string[] = [];        // White-POV eval text per position (parallel to wins)
  export let labels: string[] = [];       // move label per position (parallel to wins; index 0 = "Start")
  export let classes: (ClassificationDto | null)[] = []; // per-position classification (for the tooltip badge)
  export let currentPly = 0;              // 0..wins.length-1
  export let onNavigate: (ply: number) => void = () => {};

  const W = 340, H = 96;
  $: n = wins.length;
  $: xAt = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  $: yAt = (w: number) => H * (1 - w / 100);
  $: curve = wins.map((w, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(w).toFixed(1)}`).join(' ');
  $: area = n ? `M0 ${H} L${curve.slice(1)} L${W} ${H} Z` : '';
  $: midY = yAt(50).toFixed(1);
  $: mx = xAt(currentPly).toFixed(1);
  $: my = yAt(wins[currentPly] ?? 50).toFixed(1);

  // Nearest evaluated position under the cursor, or null when the graph is empty.
  function nearestIdx(e: MouseEvent): number | null {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    if (r.width === 0 || n <= 1) return null;
    const frac = (e.clientX - r.left) / r.width;
    return Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
  }

  let hoverIdx: number | null = null;
  function onClick(e: MouseEvent): void { const i = nearestIdx(e); if (i !== null) onNavigate(i); }
  function onMove(e: MouseEvent): void { hoverIdx = nearestIdx(e); }
  function onLeave(): void { hoverIdx = null; }

  // Hover marker + HTML tooltip (positioned in % because the SVG uses
  // preserveAspectRatio="none", which would stretch any in-SVG <text>).
  $: hx = hoverIdx !== null ? xAt(hoverIdx).toFixed(1) : '0';
  $: hy = hoverIdx !== null ? yAt(wins[hoverIdx] ?? 50).toFixed(1) : '0';
  $: tipLeftPct = hoverIdx !== null && n > 1 ? (hoverIdx / (n - 1)) * 100 : 0;
  $: tipTransform = tipLeftPct < 15 ? 'translateX(0)' : tipLeftPct > 85 ? 'translateX(-100%)' : 'translateX(-50%)';
  // Annotate the tooltip only for "notable" moves — moveColor returns null for
  // ordinary/best moves, matching how the move list highlights (and Lichess).
  $: hoverCls = hoverIdx !== null ? classes[hoverIdx] ?? null : null;
  $: hoverClsColor = moveColor(hoverCls);
  $: hoverClsName = hoverCls ? hoverCls.label.charAt(0).toUpperCase() + hoverCls.label.slice(1) : '';
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<div class="eval-graph-wrap">
  <svg class="eval-graph" viewBox="0 0 {W} {H}" preserveAspectRatio="none"
       role="img" aria-label="Evaluation graph"
       on:click={onClick} on:mousemove={onMove} on:mouseleave={onLeave}>
    <rect x="0" y="0" width={W} height={H} fill="var(--ink-2)" />
    {#if area}<path d={area} fill="var(--paper-2)" />{/if}
    <line x1="0" y1={midY} x2={W} y2={midY} stroke="var(--keyline-2)" stroke-width="1" stroke-dasharray="3 3" opacity="0.55" />
    {#if curve}<path data-testid="eval-curve" d={curve} fill="none" stroke="var(--green)" stroke-width="1.6" />{/if}
    <line data-testid="eval-marker" x1={mx} y1="0" x2={mx} y2={H} stroke="var(--amber)" stroke-width="1.4" />
    <circle cx={mx} cy={my} r="3.4" fill="var(--amber)" stroke="#fff" stroke-width="1.4" />
    {#if hoverIdx !== null}
      <line class="hover-line" x1={hx} y1="0" x2={hx} y2={H} stroke="var(--ink-faint)" stroke-width="1" opacity="0.75" />
      <circle class="hover-dot" cx={hx} cy={hy} r="3" fill="#fff" stroke="var(--ink-2)" stroke-width="1.4" />
    {/if}
  </svg>
  {#if hoverIdx !== null && evals[hoverIdx]}
    <div class="eval-tip" data-testid="eval-tip" style="left: {tipLeftPct}%; transform: {tipTransform};">
      <span class="tip-move">{labels[hoverIdx] ?? ''}</span>
      {#if hoverClsColor}<span class="tip-cls" data-testid="eval-tip-cls" style="color: {hoverClsColor};">{hoverClsName}</span>{/if}
      <span class="tip-eval">{evals[hoverIdx] ?? ''}</span>
    </div>
  {/if}
</div>

<style>
  .eval-graph-wrap { position: relative; width: 100%; }
  .eval-graph { width: 100%; height: 96px; display: block; border: 1px solid var(--keyline); border-radius: 6px; cursor: pointer; }
  .hover-line, .hover-dot { pointer-events: none; }
  .eval-tip {
    position: absolute; top: 4px; pointer-events: none; white-space: nowrap;
    display: flex; align-items: baseline; gap: 8px;
    padding: 3px 7px; border: 1px solid var(--keyline-2); border-radius: 5px;
    background: var(--paper); box-shadow: 0 2px 6px rgba(0,0,0,0.12);
    font-size: 11px; z-index: 2;
  }
  .tip-move { color: var(--ink-2); font-weight: 600; }
  .tip-cls { font-weight: 700; font-size: 10.5px; }
  .tip-eval { font-family: var(--mono); font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
</style>
