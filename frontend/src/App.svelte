<script lang="ts">
  import { onMount } from 'svelte';
  import { state, lastError, errorSeq, regionShot, connect, send } from './lib/ws';
  import { buildFen, kingCountOk } from './lib/edit';
  import Board from './components/Board.svelte';
  import BoardBadge from './components/BoardBadge.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import EditPalette from './components/EditPalette.svelte';
  import RegionOverlay from './components/RegionOverlay.svelte';
  import Header from './components/Header.svelte';
  import BoardControls from './components/BoardControls.svelte';
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

  function onFlip() { manualFlip = true; orientation = orientation === 'white' ? 'black' : 'white'; }
  function onMove(uci: string) { send({ type: 'make_move', uci }); }

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

<div class="app">
  <Header />
  <main>
    <div class="board-col">
      {#if showEvalBar}<EvalBar evalDto={s?.eval ?? null} />{/if}
      <div class="board-wrap">
        <Board bind:this={boardComp} {fen} {orientation} {onMove} revertSignal={$errorSeq}
          lines={s?.lines ?? []} {showArrows} {editing} {selectedEditPiece} />
        {#if !editing}<BoardBadge lastMove={s?.lastMove ?? null} {orientation} />{/if}
        <BoardControls sideToMove={s?.sideToMove ?? 'white'}
          onSetTurn={(white) => send({ type: 'set_turn', white })} onFlip={onFlip} />
      </div>
      {#if editing}<EditPalette selected={selectedEditPiece} onSelect={onSelectPiece} />{/if}
      {#if editError}<div class="err" role="alert" data-testid="edit-error">{editError}</div>{/if}
    </div>
    <div class="panel">
      <section class="card">
        <!-- F10 fills these: engine header, lines, move feedback, move history, source, position, action bar -->
        <div class="sec" data-testid="card-placeholder"></div>
      </section>
    </div>
  </main>
  {#if pickingRegion}
    <RegionOverlay shot={$regionShot} onConfirm={onConfirmRegion} onCancel={onCancelRegion} />
  {/if}
</div>

<style>
  .app {
    width: 100%;
    max-width: 1320px;
    height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
  }

  main {
    display: flex;
    gap: 22px;
    align-items: stretch;
    justify-content: center;
    flex: 1;
    min-height: 0;
  }

  /* ===== board column ===== */
  .board-col {
    display: flex;
    gap: 10px;
    flex: none;
    align-self: flex-start;
    animation: rise .55s .05s ease both;
  }

  .board-wrap {
    position: relative;
    width: var(--bsize);
  }

  /* ===== right panel ===== */
  .panel {
    width: 384px;
    flex: none;
    display: flex;
    flex-direction: column;
  }

  .card {
    background: var(--card);
    border: 1px solid var(--keyline);
    border-radius: 7px;
    box-shadow: 0 1px 0 #fff inset, 0 12px 30px -24px rgba(40,30,15,.45);
    animation: rise .55s ease both;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .err {
    color: var(--blun);
    font-size: 12px;
  }

  @keyframes rise {
    from { opacity: 0; transform: translateY(9px); }
    to   { opacity: 1; transform: none; }
  }
</style>
