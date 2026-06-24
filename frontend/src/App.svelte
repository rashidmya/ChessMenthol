<script lang="ts">
  import { onMount } from 'svelte';
  import { state, lastError, connected, connect, send } from './lib/ws';
  import type { Command } from './lib/types';
  import Board from './components/Board.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import Lines from './components/Lines.svelte';
  import Badge from './components/Badge.svelte';
  import Controls from './components/Controls.svelte';

  let orientation: 'white' | 'black' = 'white';

  onMount(() => { connect(); });

  function onCommand(cmd: Command) { send(cmd); }
  function onFlip() { orientation = orientation === 'white' ? 'black' : 'white'; }
  function onMove(uci: string) { send({ type: 'make_move', uci }); }

  $: s = $state;
  $: fen = s?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
</script>

<main>
  <header>
    <h1>♟ ChessMenthol</h1>
    <span class="conn" class:on={$connected}>{$connected ? 'connected' : 'connecting…'}</span>
  </header>

  <div class="app">
    <EvalBar evalDto={s?.eval ?? null} />
    <div class="board-wrap">
      <Board {fen} {orientation} {onMove} />
    </div>
    <aside class="panel">
      <div class="box"><div class="label">Engine lines</div>
        <Lines lines={s?.lines ?? []} />
      </div>
      <div class="box"><div class="label">Last move</div>
        <Badge lastMove={s?.lastMove ?? null} />
      </div>
      <div class="box"><div class="label">Controls</div>
        <Controls sideToMove={s?.sideToMove ?? 'white'} engineId={s?.engineId ?? 'stockfish'}
          analyzing={s?.analyzing ?? false} fen={s?.fen ?? ''}
          {onCommand} {onFlip} />
      </div>
      {#if $lastError}<div class="err">{$lastError}</div>{/if}
    </aside>
  </div>
</main>

<style>
  :global(body) { margin: 0; background: #1b1d22; color: #e6e6e6;
    font-family: system-ui, sans-serif; }
  main { padding: 14px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  h1 { font-size: 18px; margin: 0; }
  .conn { font-size: 11px; opacity: 0.6; }
  .conn.on { color: #11a26b; opacity: 1; }
  .app { display: flex; gap: 14px; align-items: flex-start; }
  .board-wrap { width: min(60vh, 560px); flex: 0 0 auto; }
  .panel { width: 320px; flex: 0 0 320px; display: flex; flex-direction: column; gap: 10px; }
  .box { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px; padding: 10px; }
  .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px;
    opacity: 0.55; margin-bottom: 6px; }
  .err { color: #fa412d; font-size: 12px; }
</style>
