<script lang="ts">
  export let selected: string | null = 'P';
  export let onSelect: (tok: string) => void = () => {};

  const TOKENS = ['P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'];
  const GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
  const glyph = (t: string) => GLYPH[t.toLowerCase()];
  const isWhite = (t: string) => t === t.toUpperCase();
</script>

<div class="palette" data-testid="edit-palette">
  {#each TOKENS as tok}
    <button data-testid={'pal-' + tok} class:on={selected === tok}
      class={isWhite(tok) ? 'pc w' : 'pc b'} on:click={() => onSelect(tok)}>{glyph(tok)}</button>
  {/each}
  <button data-testid="pal-trash" class="trash" class:on={selected === 'trash'}
    on:click={() => onSelect('trash')}>🗑</button>
</div>

<style>
  .palette { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px; padding: 6px; }
  button { font-size: 22px; width: 34px; height: 34px; line-height: 1; cursor: pointer;
    border-radius: 5px; background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15); color: inherit; }
  button.on { background: rgba(17,162,107,0.3); border-color: #11a26b; }
  .pc.w { color: #fff; text-shadow: 0 0 1px #000, 1px 1px 0 #444; }
  .pc.b { color: #111; text-shadow: 0 0 1px #fff; }
  .trash { font-size: 16px; }
</style>
