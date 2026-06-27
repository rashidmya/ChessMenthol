<script lang="ts">
  import { onMount } from 'svelte';
  import { state, lastError, errorSeq, regionShot, connect, send } from './lib/ws';
  import { buildFen, kingCountOk } from './lib/edit';
  import { loadViewPrefs, saveViewPrefs } from './lib/viewprefs';
  import type { ViewPrefs } from './lib/viewprefs';
  import Board from './components/Board.svelte';
  import BoardBadge from './components/BoardBadge.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import EditPalette from './components/EditPalette.svelte';
  import RegionOverlay from './components/RegionOverlay.svelte';
  import Header from './components/Header.svelte';
  import BoardControls from './components/BoardControls.svelte';
  import EngineHeader from './components/EngineHeader.svelte';
  import Lines from './components/Lines.svelte';
  import MoveFeedback from './components/MoveFeedback.svelte';
  import MoveHistory from './components/MoveHistory.svelte';
  import SourceControls from './components/SourceControls.svelte';
  import PositionControls from './components/PositionControls.svelte';
  import ActionBar from './components/ActionBar.svelte';
  import type { Region } from './lib/region';

  let orientation: 'white' | 'black' = 'white';
  let manualFlip = false;
  let editing = false;
  let selectedEditPiece: string | null = 'P';
  let viewPrefs: ViewPrefs = loadViewPrefs();
  let editError: string | null = null;
  let committing = false;
  let lastSeq = 0;
  let committedPlacement: string | null = null;
  let boardComp: Board;
  let pickingRegion = false;
  function onPickRegion() { regionShot.set(null); pickingRegion = true; send({ type: 'request_region_shot' }); }
  function onConfirmRegion(r: Region) { pickingRegion = false; send({ type: 'set_region', ...r }); }
  function onCancelRegion() { pickingRegion = false; }

  function onToggleView(key: 'evalBar' | 'lines' | 'arrows' | 'feedback') {
    viewPrefs = { ...viewPrefs, [key]: !viewPrefs[key] };
    saveViewPrefs(viewPrefs);
  }

  onMount(() => { connect(); });

  function onFlip() { manualFlip = true; orientation = orientation === 'white' ? 'black' : 'white'; }
  function onMove(uci: string) { send({ type: 'make_move', uci }); }
  function onNavigate(i: number) { send({ type: 'navigate', index: i }); }

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
  // When analysis is off, the analysis-derived surfaces (eval bar, engine lines,
  // suggestion arrows, move feedback) and the View-options menu are hidden entirely,
  // regardless of the view-toggle prefs; they return (per the prefs) when re-enabled.
  $: analysisEnabled = s?.analysisEnabled ?? true;
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
      {#if viewPrefs.evalBar && analysisEnabled}<EvalBar evalDto={s?.eval ?? null} />{/if}
      <div class="board-wrap">
        <Board bind:this={boardComp} {fen} {orientation} {onMove} revertSignal={$errorSeq}
          lines={s?.lines ?? []} showArrows={viewPrefs.arrows && analysisEnabled} {editing} {selectedEditPiece} />
        {#if !editing}<BoardBadge lastMove={s?.lastMove ?? null} {orientation} />{/if}
        <BoardControls sideToMove={s?.sideToMove ?? 'white'}
          onSetTurn={(white) => send({ type: 'set_turn', white })} onFlip={onFlip} />
      </div>
      {#if editing}<EditPalette selected={selectedEditPiece} onSelect={onSelectPiece} />{/if}
      {#if editError}<div class="err" role="alert" data-testid="edit-error">{editError}</div>{/if}
    </div>
    <div class="panel">
      <section class="card">
        <!-- 1. Engine header + engine lines (one section) -->
        <!-- NOTE: EngineSettings search-time slider defaults to index 2 (10s), which already
             matches the backend default movetime (10s). Initializing the slider from s.movetime
             is deliberately deferred — defaults align and no prop plumbing is needed yet. -->
        <div class="sec">
          <EngineHeader
            {analysisEnabled}
            analyzing={s?.analyzing ?? false}
            depth={s?.depth ?? 0}
            engineId={s?.engineId ?? 'stockfish'}
            onCommand={send}
            onSetEngine={(id) => send({ type: 'set_engine', id })}
            prefs={viewPrefs}
            onToggle={onToggleView} />
          {#if viewPrefs.lines && analysisEnabled && (s?.lines?.length ?? 0) > 0}
            <div class="bd">
              {#key s?.fen}
                <Lines lines={s?.lines ?? []} />
              {/key}
            </div>
          {/if}
        </div>

        <!-- 2. Move feedback — hidden until there's a move to describe, so no empty divider -->
        {#if viewPrefs.feedback && analysisEnabled && s?.lastMove}
          <div class="sec" data-testid="feedback-section">
            <div class="bd">
              <MoveFeedback lastMove={s?.lastMove ?? null}
                onPlayBest={(uci) => send({ type: 'play_best', uci })} />
            </div>
          </div>
        {/if}

        <!-- 3. Move history (renders its own .movehist-sec; wrap in a growing .sec
             so the history list absorbs the card's remaining height and scrolls) -->
        <div class="sec grow">
          <MoveHistory moveList={s?.moveList ?? []} currentPly={s?.currentPly ?? 0}
            {onNavigate} />
        </div>

        <!-- 4. Source controls -->
        <div class="sec">
          <SourceControls region={s?.region ?? null}
            visionStatus={s?.visionStatus ?? 'idle'}
            lowConfidence={s?.lowConfidence ?? []}
            onCommand={send} onPickRegion={onPickRegion} />
        </div>

        <!-- 5. Position controls -->
        <div class="sec">
          <PositionControls editing={editing} onCommand={send} onToggleEdit={onToggleEdit} />
        </div>

        <!-- 6. Action bar -->
        <div class="sec">
          <ActionBar currentPly={s?.currentPly ?? 0} total={s?.moveList?.length ?? 0}
            {onNavigate} />
        </div>
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

  /* ===== card section dividers ===== */
  .bd { padding: 7px 10px; }
  .sec + .sec { border-top: 1px solid var(--keyline); }
  /* Only the move-history section grows to absorb the card's remaining height,
     letting its inner .movehist-sec (flex:1) and .movehist (overflow-y:auto) scroll. */
  .grow { flex: 1; min-height: 0; display: flex; flex-direction: column; }

  .err {
    color: var(--blun);
    font-size: 12px;
  }

  @keyframes rise {
    from { opacity: 0; transform: translateY(9px); }
    to   { opacity: 1; transform: none; }
  }
</style>
