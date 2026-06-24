<script lang="ts">
  import type { LineDto } from '../lib/types';
  export let lines: LineDto[] = [];
</script>

<ul class="lines" data-testid="lines">
  {#each lines as line (line.multipv)}
    <li class="row" data-testid="line-row">
      <span class="score">{line.scoreText}</span>
      <span class="san">{line.san}</span>
    </li>
  {/each}
</ul>

<style>
  .lines { list-style: none; margin: 0; padding: 0; font-family: monospace; font-size: 12px; }
  .row { display: flex; gap: 8px; padding: 2px 0; }
  .score { width: 52px; color: #9ad; flex: 0 0 auto; }
  .san { color: #ddd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
