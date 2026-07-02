<script lang="ts">
  // Renders a Lichess icon-font glyph. `name` is a key of the vendored licon map;
  // the matching PUA char is placed in data-icon and drawn by the global
  // [data-icon]::before rule in app.css. The glyph inherits the surrounding
  // font-size and currentColor.
  import { licon, type LiconKey } from '../lib/licon';

  export let name: LiconKey;
  // Provide `label` only for a standalone, meaningful icon (becomes role="img").
  // Omit it when the icon is decorative (next to a text label, or inside a button
  // that already has its own aria-label) — it is then hidden from a11y.
  export let label: string | undefined = undefined;
  // Optional one-off CSS font-size override (e.g. "19px"); usually inherited.
  export let size: string | undefined = undefined;
</script>

<span
  class="icon"
  data-icon={licon[name]}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : true}
  style={size ? `font-size:${size}` : undefined}
></span>
