import { readable } from 'svelte/store';

/** Max viewport width (px) treated as "narrow" (single-column mobile layout).
 *  MUST stay in sync with the `@media (max-width: 819.98px)` blocks in the CSS. */
export const NARROW_MAX = 819.98;

/** `true` while the viewport is narrow (phone/tablet-portrait / small window).
 *  Backed by matchMedia; safely `false` where matchMedia is unavailable (SSR/jsdom). */
export const isNarrow = readable(false, (set) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mq = window.matchMedia(`(max-width: ${NARROW_MAX}px)`);
  set(mq.matches);
  const onChange = (e: { matches: boolean }) => set(e.matches);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
});
