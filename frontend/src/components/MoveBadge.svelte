<script context="module" lang="ts">
  // Per-instance id source so multiple badges on one page never share a <defs> id.
  let _uid = 0;
</script>

<script lang="ts">
  import { glyphFor } from '../lib/glyphs';

  export let label: string;
  export let size = 20;
  export let title: string | undefined = undefined;

  $: spec = glyphFor(label);
  $: isDouble = spec.symbol.length > 1;
  $: resolvedTitle = title ?? (label.charAt(0).toUpperCase() + label.slice(1));
  const gid = `mb-sheen-${++_uid}`;
</script>

<svg class="move-badge" width={size} height={size} viewBox="0 0 34 34"
     role="img" aria-label={resolvedTitle}>
  <defs>
    <radialGradient id={gid} cx="0.5" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#fff" stop-opacity="0.28" />
      <stop offset="0.6" stop-color="#fff" stop-opacity="0" />
    </radialGradient>
  </defs>
  <circle cx="17" cy="17" r="16" fill={spec.color} />
  <circle cx="17" cy="17" r="16" fill="url(#{gid})" />

  {#if spec.kind === 'text'}
    <text x="17" y="17.8" text-anchor="middle" dominant-baseline="middle"
          letter-spacing={isDouble ? -1 : 0}
          font-family="system-ui, sans-serif" font-weight="800"
          font-size={isDouble ? 17 : 18.5} fill="#fff">{spec.symbol}</text>
  {:else if spec.kind === 'check'}
    <path d="M10 17.5 l4.2 4.2 L24 11" fill="none" stroke="#fff"
          stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  {:else if spec.kind === 'cross'}
    <path d="M11 11 L23 23 M23 11 L11 23" fill="none" stroke="#fff"
          stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  {:else if spec.kind === 'star'}
    <path d="M17 7.5 l2.7 5.9 6.4 .7 -4.8 4.3 1.3 6.3 -5.6 -3.2 -5.6 3.2 1.3 -6.3 -4.8 -4.3 6.4 -.7 z"
          fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round" />
  {:else if spec.kind === 'book'}
    <path d="M17 11 C14.5 9.2 11 9 8.5 9.6 V24 C11 23.4 14.5 23.6 17 25 C19.5 23.6 23 23.4 25.5 24 V9.6 C23 9 19.5 9.2 17 11 Z M17 11 V25"
          fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  {:else if spec.kind === 'thumb'}
    <g transform="translate(6.5,6.7) scale(0.875)">
      <path fill="#fff" d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
    </g>
  {/if}
</svg>

<style>
  .move-badge {
    display: inline-block;
    vertical-align: middle;
    filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.35));
  }
</style>
