<script lang="ts">
  import { onMount } from 'svelte';
  import { state, errorSeq, regionShot, connect, send } from './lib/engineClient';
  import { buildFen, kingCountOk, castleFromFen } from './lib/edit';
  import { currentLastMoveUci } from './lib/board';
  import type { CastlingRights } from './lib/edit';
  import { loadViewPrefs, saveViewPrefs } from './lib/viewprefs';
  import type { ViewPrefs } from './lib/viewprefs';
  import Board from './components/Board.svelte';
  import BoardBadge from './components/BoardBadge.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import RegionOverlay from './components/RegionOverlay.svelte';
  import Header from './components/Header.svelte';
  import BoardControls from './components/BoardControls.svelte';
  import EngineHeader from './components/EngineHeader.svelte';
  import Lines from './components/Lines.svelte';
  import MoveFeedback from './components/MoveFeedback.svelte';
  import MoveHistory from './components/MoveHistory.svelte';
  import HomePanel from './components/HomePanel.svelte';
  import EditPanel from './components/EditPanel.svelte';
  import ActionBar from './components/ActionBar.svelte';
  import { captureCommands, type Region } from './lib/region';
  import { hasNativeCapture } from './lib/capture';

  let orientation: 'white' | 'black' = 'white';
  let manualFlip = false;
  let selectedEditPiece: string | null = 'P';
  type Screen = 'home' | 'analysis' | 'edit';
  let screen: Screen = 'home';
  // Editor form state (initialized when entering the editor)
  let editSide: 'white' | 'black' = 'white';
  let editCastle: CastlingRights = { K: true, Q: true, k: true, q: true };
  let editFen = '';
  let viewPrefs: ViewPrefs = loadViewPrefs();
  let editError: string | null = null;
  let boardComp: Board;
  const hasCapture = hasNativeCapture(); // true inside Tauri; false in a plain browser
  let pickingRegion = false;
  function onPickRegion() { regionShot.set(null); pickingRegion = true; send({ type: 'request_region_shot' }); }
  function onConfirmRegion(r: Region) {
    pickingRegion = false;
    for (const c of captureCommands(r)) send(c);
    enterAnalysis();
  }
  function onCancelRegion() { pickingRegion = false; }

  function onToggleView(key: 'evalBar' | 'lines' | 'arrows' | 'feedback') {
    viewPrefs = { ...viewPrefs, [key]: !viewPrefs[key] };
    saveViewPrefs(viewPrefs);
  }

  onMount(() => { connect(); });

  function onFlip() { manualFlip = true; orientation = orientation === 'white' ? 'black' : 'white'; }
  function onMove(uci: string) {
    if (screen === 'home') enterAnalysis();
    send({ type: 'make_move', uci });
  }
  function onNavigate(i: number) { send({ type: 'navigate', index: i }); }

  // ===== Navigation =====
  function enterAnalysis(): void {
    screen = 'analysis';
    send({ type: 'set_analysis_enabled', enabled: true });
  }
  function onExplore(): void { enterAnalysis(); }
  function onStart(text: string): void {
    const fen = text.trim();
    if (fen) send({ type: 'set_fen', fen });   // PGN parsing deferred; treated as FEN for now
    enterAnalysis();
  }
  function onNew(): void {
    screen = 'home';
    manualFlip = false;
    send({ type: 'set_analysis_enabled', enabled: false });
    send({ type: 'reset' });
  }
  function onSetUp(): void {
    editError = null;
    const f = s?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    editSide = (s?.sideToMove ?? 'white') as 'white' | 'black';
    editCastle = castleFromFen(f);
    editFen = f;
    selectedEditPiece = 'P';
    screen = 'edit';
  }
  function onEditBack(): void { screen = 'home'; editError = null; }

  // ===== Editor form handlers =====
  function rebuildEditFen(): void {
    editFen = buildFen(boardComp.getPlacement(), editSide, editCastle);
  }
  function onEditSide(white: boolean): void { editSide = white ? 'white' : 'black'; rebuildEditFen(); }
  function onToggleCastle(key: keyof CastlingRights): void {
    editCastle = { ...editCastle, [key]: !editCastle[key] };
    rebuildEditFen();
  }
  function onBoardEdit(_placement: string): void { rebuildEditFen(); }
  function onEditFenInput(text: string): void { editFen = text; }
  function onEditReset(): void {
    boardComp.setPlacement('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    rebuildEditFen();
  }
  function onEditClear(): void { boardComp.setPlacement('8/8/8/8/8/8/8/8'); rebuildEditFen(); }
  function onEditLoad(): void {
    const placement = boardComp.getPlacement();
    if (!kingCountOk(placement)) { editError = 'Need exactly one white and one black king.'; return; }
    editError = null;
    send({ type: 'set_fen', fen: editFen });
    enterAnalysis();
  }
  function onSelectPiece(tok: string) { selectedEditPiece = tok; }

  $: s = $state;
  $: editing = screen === 'edit';
  // When analysis is off, the analysis-derived surfaces (eval bar, engine lines,
  // suggestion arrows, move feedback) and the View-options menu are hidden entirely,
  // regardless of the view-toggle prefs; they return (per the prefs) when re-enabled.
  $: analysisEnabled = s?.analysisEnabled ?? false;  // off until the first frame (analysis is off by default)
  // The engine lines block (and the header divider above it) only appear when analysis
  // is on and there are lines to show — otherwise the header divider would dangle.
  $: showLines = viewPrefs.lines && analysisEnabled && (s?.lines?.length ?? 0) > 0;
  $: fen = s?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  // The board's yellow last-move highlight is driven from authoritative state
  // (the move at the current ply), so it follows navigation and clears on
  // reset/New — null at the start of a game means "no highlight".
  $: lastMoveUci = currentLastMoveUci(s?.moveList ?? [], s?.currentPly ?? 0);
  $: if (s?.detectedOrientation && !manualFlip) {
    orientation = s.detectedOrientation as 'white' | 'black';
  }
</script>

<div class="app">
  <Header />
  <main>
    <div class="board-col">
      <div class="board-wrap">
        {#if viewPrefs.evalBar && analysisEnabled}
          <div class="evalbar-slot"><EvalBar evalDto={s?.eval ?? null} {orientation} gameOver={s?.gameOver ?? null} /></div>
        {/if}
        <Board bind:this={boardComp} {fen} {orientation} {onMove} revertSignal={$errorSeq}
          lastMove={lastMoveUci}
          lines={s?.lines ?? []} showArrows={viewPrefs.arrows && analysisEnabled}
          {editing} {selectedEditPiece} onEdit={onBoardEdit} />
        {#if !editing}<BoardBadge lastMove={s?.lastMove ?? null} {orientation} />{/if}
        <!-- Analysis-only: Home is a clean start screen, and in Edit the EditPanel owns
             the side-to-move dropdown + its own flip, so the board-column turn/flip
             control would only duplicate them (mockup v3). -->
        {#if screen === 'analysis'}
          <BoardControls sideToMove={s?.sideToMove ?? 'white'}
            onSetTurn={(white) => send({ type: 'set_turn', white })} onFlip={onFlip} />
        {/if}
      </div>
    </div>
    <div class="panel">
      {#if screen === 'home'}
        <HomePanel hasCapture={hasCapture} onSetUp={onSetUp} onExplore={onExplore}
          onCapture={onPickRegion} onStart={onStart} />
      {:else if screen === 'edit'}
        <EditPanel fen={editFen} side={editSide} castle={editCastle} selected={selectedEditPiece}
          editError={editError}
          onSelect={onSelectPiece} onSide={onEditSide} onToggleCastle={onToggleCastle}
          onFlip={onFlip} onReset={onEditReset} onClear={onEditClear}
          onFenInput={onEditFenInput} onLoad={onEditLoad} onBack={onEditBack} />
      {:else}
        <section class="card" data-testid="analysis-card">
          <!-- 1. Engine header + engine lines (one section) -->
          <!-- NOTE: EngineSettings search-time slider defaults to index 2 (10s), which already
               matches the backend default movetime (10s). Initializing the slider from s.movetime
               is deliberately deferred — defaults align and no prop plumbing is needed yet. -->
          <div class="sec">
            <EngineHeader
              {analysisEnabled}
              divider={showLines}
              analyzing={s?.analyzing ?? false}
              depth={s?.depth ?? 0}
              engineId={s?.engineId ?? 'stockfish'}
              onCommand={send}
              onSetEngine={(id) => send({ type: 'set_engine', id })}
              prefs={viewPrefs}
              onToggle={onToggleView} />
            {#if showLines}
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
                  onPlayBest={(uci) => send({ type: 'play_best', uci })}
                  gameOver={s?.gameOver ?? null} />
              </div>
            </div>
          {/if}

          <!-- 3. Move history (renders its own .movehist-sec; wrap in a growing .sec
               so the history list absorbs the card's remaining height and scrolls) -->
          <div class="sec grow">
            <MoveHistory moveList={s?.moveList ?? []} currentPly={s?.currentPly ?? 0}
              {onNavigate} />
          </div>

          <!-- 4. Action bar -->
          <div class="sec">
            <ActionBar currentPly={s?.currentPly ?? 0} total={s?.moveList?.length ?? 0}
              {onNavigate} onNew={onNew} />
          </div>
        </section>
      {/if}
    </div>
  </main>
  {#if pickingRegion && hasCapture}
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
    flex: none;
    align-self: flex-start;
    animation: rise .55s .05s ease both;
  }

  .board-wrap {
    position: relative;
    width: var(--bsize);
  }

  /* The eval bar sits to the LEFT of the board, but it's taken out of flow so it never
     widens .board-col. That's what keeps the board fixed in place when the bar toggles
     on/off (otherwise the center-justified board+panel group shifts right). Pure
     positioning: anchored to the board-wrap's top-left and translated fully left — its
     own width plus a 10px gap — so it pokes into the whitespace left of the header
     divider. The bar's height is var(--bsize) (set in EvalBar), which is exactly the
     board's height: the board is an aspect-ratio:1/1 square filling .board-wrap, whose
     width is var(--bsize). (top:0 aligns it to the board, not the taller .board-wrap,
     which also contains the BoardControls below the board.) */
  .evalbar-slot {
    position: absolute;
    top: 0;
    left: 0;
    transform: translateX(calc(-100% - 10px));
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
    box-shadow: 0 .1rem .1rem 0 rgba(0, 0, 0, .2);
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

  @keyframes rise {
    from { opacity: 0; transform: translateY(9px); }
    to   { opacity: 1; transform: none; }
  }
</style>
