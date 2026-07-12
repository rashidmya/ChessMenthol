<script lang="ts">
  export let percent = 0;      // 0..100
  export let label = '';
  export let side: 'white' | 'black' | null = null;
  export let testid: string | undefined = undefined;

  const R = 38, CX = 48, CY = 48;
  const C = 2 * Math.PI * R;
  $: off = C * (1 - Math.max(0, Math.min(100, percent)) / 100);
  // Colour band: high = green, mid = amber, low = red (matches move-class palette).
  $: color = percent >= 80 ? 'var(--best)' : percent >= 60 ? 'var(--inacc)' : 'var(--mist)';
</script>

<div class="dial" data-testid={testid}>
  <svg width="96" height="96" viewBox="0 0 96 96">
    <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--keyline)" stroke-width="8" />
    <circle cx={CX} cy={CY} r={R} fill="none" stroke={color} stroke-width="8" stroke-linecap="round"
            stroke-dasharray={C} stroke-dashoffset={off} transform="rotate(-90 {CX} {CY})" />
    <text class="num" x="48" y="50" text-anchor="middle" dominant-baseline="middle">{Math.round(percent)}<tspan font-size="12" dy="-8">%</tspan></text>
  </svg>
  <span class="who">
    {#if side}<span class="side-dot {side}"></span>{/if}{label}
  </span>
</div>

<style>
  .dial { display: flex; flex-direction: column; align-items: center; gap: 7px; }
  .num { font-family: var(--serif); font-weight: 600; font-size: 23px; fill: var(--ink); }
  .who { font-family: var(--mono); font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); display: flex; align-items: center; gap: 6px; }
</style>
