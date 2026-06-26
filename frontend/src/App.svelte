<script lang="ts">
  import { onMount } from 'svelte';
  import { state, lastError, connected, errorSeq, connect, send } from './lib/ws';
  import type { Command } from './lib/types';
  import { buildFen, kingCountOk } from './lib/edit';
  import Board from './components/Board.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import Lines from './components/Lines.svelte';
  import Badge from './components/Badge.svelte';
  import Controls from './components/Controls.svelte';
  import EditPalette from './components/EditPalette.svelte';

  let orientation: 'white' | 'black' = 'white';
  let manualFlip = false;
  let editing = false;
  let selectedEditPiece: string | null = 'P';
  let showArrows = true;
  let showEvalBar = true;
  let editError: string | null = null;
  let committing = false;
  let lastSeq = 0;
  let boardComp: Board;

  onMount(() => { connect(); });

  function onCommand(cmd: Command) {
    if (cmd.type === 'set_auto' && cmd.on) manualFlip = false;
    send(cmd);
  }
  function onFlip() { manualFlip = true; orientation = orientation === 'white' ? 'black' : 'white'; }
  function onMove(uci: string) { send({ type: 'make_move', uci }); }

  function onToggleEdit() {
    if (!editing) {
      editError = null;
      send({ type: 'set_auto', on: false }); // freeze the board while editing
      editing = true;
      return;
    }
    const placement = boardComp.getPlacement();
    if (!kingCountOk(placement)) {
      editError = 'Need exactly one white and one black king.';
      return; // stay in edit mode
    }
    editError = null;
    lastSeq = $errorSeq;
    committing = true;
    send({ type: 'set_fen', fen: buildFen(placement, s?.sideToMove ?? 'white') });
    editing = false;
  }
  function onSelectPiece(tok: string) { selectedEditPiece = tok; }

  $: s = $state;
  $: fen = s?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  $: if (s?.tracking && s?.detectedOrientation && !manualFlip) {
    orientation = s.detectedOrientation as 'white' | 'black';
  }
  // If the server rejected the commit, drop back into edit mode so the fix isn't lost.
  $: if (committing && $errorSeq !== lastSeq) {
    committing = false; editing = true; editError = $lastError;
  }
  // A state frame after a commit means it was accepted.
  $: if (committing && s) { committing = false; }
</script>

<main>
  <header>
    <h1>♟ ChessMenthol</h1>
    <span class="conn" class:on={$connected}>{$connected ? 'connected' : 'connecting…'}</span>
  </header>

  <div class="app">
    {#if showEvalBar}<EvalBar evalDto={s?.eval ?? null} />{/if}
    <div class="board-wrap">
      <Board bind:this={boardComp} {fen} {orientation} {onMove} revertSignal={$errorSeq}
        lines={s?.lines ?? []} {showArrows} {editing} {selectedEditPiece} />
      {#if editing}
        <EditPalette selected={selectedEditPiece} onSelect={onSelectPiece} />
      {/if}
      {#if editError}<div class="err" data-testid="edit-error">{editError}</div>{/if}
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
          tracking={s?.tracking ?? false}
          visionStatus={s?.visionStatus ?? 'off'}
          lowConfidence={s?.lowConfidence ?? []}
          editing={editing} showArrows={showArrows} showEvalBar={showEvalBar}
          onToggleEdit={onToggleEdit}
          onToggleArrows={() => (showArrows = !showArrows)}
          onToggleEvalBar={() => (showEvalBar = !showEvalBar)}
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
