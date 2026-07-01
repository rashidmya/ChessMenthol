<script lang="ts">
  export let wins: number[] = [];         // White-POV win% per position (index 0 = base)
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

  function onClick(e: MouseEvent): void {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    if (r.width === 0 || n <= 1) return;
    const frac = (e.clientX - r.left) / r.width;
    onNavigate(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<svg class="eval-graph" viewBox="0 0 {W} {H}" preserveAspectRatio="none"
     role="img" aria-label="Evaluation graph" on:click={onClick}>
  <rect x="0" y="0" width={W} height={H} fill="var(--ink-2)" />
  {#if area}<path d={area} fill="var(--paper-2)" />{/if}
  <line x1="0" y1={midY} x2={W} y2={midY} stroke="var(--keyline-2)" stroke-width="1" stroke-dasharray="3 3" opacity="0.55" />
  {#if curve}<path data-testid="eval-curve" d={curve} fill="none" stroke="var(--green)" stroke-width="1.6" />{/if}
  <line data-testid="eval-marker" x1={mx} y1="0" x2={mx} y2={H} stroke="var(--amber)" stroke-width="1.4" />
  <circle cx={mx} cy={my} r="3.4" fill="var(--amber)" stroke="#fff" stroke-width="1.4" />
</svg>

<style>
  .eval-graph { width: 100%; height: 96px; display: block; border: 1px solid var(--keyline); border-radius: 6px; cursor: pointer; }
</style>
