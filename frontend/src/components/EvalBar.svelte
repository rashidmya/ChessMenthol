<script lang="ts">
  import type { EvalDto } from '../lib/types';
  import { whitePct } from '../lib/evalbar';
  export let evalDto: EvalDto | null = null;
  $: pct = whitePct(evalDto);
</script>

<div class="evalbar" data-testid="evalbar">
  <div class="fill-white" style="height:{pct}%"></div>
  <span class="score" data-testid="eval-score">{evalDto?.text ?? ''}</span>
</div>

<style>
  .evalbar { position: relative; width: 22px; align-self: stretch;
    background: #111; border-radius: 5px; overflow: hidden; }
  .fill-white { position: absolute; bottom: 0; left: 0; right: 0; background: #f5f5f5;
    transition: height 0.2s ease; }
  .score { position: absolute; left: 50%; bottom: 4px; transform: translateX(-50%);
    font-size: 9px; color: #888; }
</style>
