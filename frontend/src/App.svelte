<script lang="ts">
  import { onMount } from 'svelte';
  import { state, lastError, connected, errorSeq, regionShot, connect, send } from './lib/ws';
  import type { Command } from './lib/types';
  import { buildFen, kingCountOk } from './lib/edit';
  import Board from './components/Board.svelte';
  import BoardBadge from './components/BoardBadge.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import Lines from './components/Lines.svelte';
  import LastMove from './components/LastMove.svelte';
  import Controls from './components/Controls.svelte';
  import EditPalette from './components/EditPalette.svelte';
  import RegionOverlay from './components/RegionOverlay.svelte';
  import type { Region } from './lib/region';

  let orientation: 'white' | 'black' = 'white';
  let manualFlip = false;
  let editing = false;
  let selectedEditPiece: string | null = 'P';
  let showArrows = true;
  let showEvalBar = true;
  let editError: string | null = null;
  let committing = false;
  let lastSeq = 0;
  let committedPlacement: string | null = null;
  let boardComp: Board;
  let pickingRegion = false;
  function onPickRegion() { regionShot.set(null); pickingRegion = true; send({ type: 'request_region_shot' }); }
  function onConfirmRegion(r: Region) { pickingRegion = false; send({ type: 'set_region', ...r }); }
  function onCancelRegion() { pickingRegion = false; }

  onMount(() => { connect(); });

  function onCommand(cmd: Command) {
    send(cmd);
  }
  function onFlip() { manualFlip = true; orientation = orientation === 'white' ? 'black' : 'white'; }
  function onMove(uci: string) { send({ type: 'make_move', uci }); }
  function onPlayBest(uci: string) { send({ type: 'play_best', uci }); }

  function onToggleEdit() {
    if (!editing) {
      editError = null;
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
    committedPlacement = placement;
    committing = true;
    send({ type: 'set_fen', fen: buildFen(placement, s?.sideToMove ?? 'white') });
    // Stay in edit mode until the server accepts (placement matches) or rejects.
  }
  function onSelectPiece(tok: string) { selectedEditPiece = tok; }

  $: s = $state;
  $: fen = s?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  $: if (s?.detectedOrientation && !manualFlip) {
    orientation = s.detectedOrientation as 'white' | 'black';
  }
  // Server rejected the commit -> stay in edit mode so the fix isn't lost.
  $: if (committing && $errorSeq !== lastSeq) {
    committing = false; editing = true; editError = $lastError; committedPlacement = null;
  }
  // Server accepted -> a state frame whose placement matches our committed placement.
  $: if (committing && s && s.fen.split(' ')[0] === committedPlacement) {
    committing = false; editing = false; committedPlacement = null;
  }
</script>

<main>
  <header>
    <h1>♟ ChessMenthol</h1>
    <span class="conn" class:on={$connected}>{$connected ? 'connected' : 'connecting…'}</span>
  </header>

  <div class="app">
    <div class="board-col">
      <div class="board-row">
        {#if showEvalBar}<EvalBar evalDto={s?.eval ?? null} />{/if}
        <div class="board-wrap">
          <Board bind:this={boardComp} {fen} {orientation} {onMove} revertSignal={$errorSeq}
            lines={s?.lines ?? []} {showArrows} {editing} {selectedEditPiece} />
          {#if !editing}<BoardBadge lastMove={s?.lastMove ?? null} {orientation} />{/if}
        </div>
      </div>
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
        <LastMove lastMove={s?.lastMove ?? null} {onPlayBest} />
      </div>
      <div class="box"><div class="label">Controls</div>
        <Controls sideToMove={s?.sideToMove ?? 'white'} engineId={s?.engineId ?? 'stockfish'}
          analyzing={s?.analyzing ?? false} fen={s?.fen ?? ''}
          region={s?.region ?? null}
          onPickRegion={onPickRegion}
          visionStatus={s?.visionStatus ?? 'idle'}
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
  {#if pickingRegion}
    <RegionOverlay shot={$regionShot} onConfirm={onConfirmRegion} onCancel={onCancelRegion} />
  {/if}
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
  .board-col { display: flex; flex-direction: column; gap: 8px; }
  .board-row { display: flex; gap: 8px; align-items: stretch; }
  .board-wrap { width: min(60vh, 560px); flex: 0 0 auto; position: relative; }
  .panel { width: 320px; flex: 0 0 320px; display: flex; flex-direction: column; gap: 10px; }
  .box { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px; padding: 10px; }
  .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px;
    opacity: 0.55; margin-bottom: 6px; }
  .err { color: #fa412d; font-size: 12px; }
</style>
