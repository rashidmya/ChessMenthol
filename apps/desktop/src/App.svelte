<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { state, errorSeq, lastError, regionShot, connect, send, report, reportProgress } from './lib/engineClient';
  import { buildFen, kingCountOk, castleFromFen } from '@chessmenthol/core/lib/edit';
  import { currentLastMoveUci } from '@chessmenthol/core/lib/board';
  import type { CastlingRights } from '@chessmenthol/core/lib/edit';
  import { loadViewPrefs, saveViewPrefs } from './lib/viewprefs';
  import type { ViewPrefs } from './lib/viewprefs';
  import Board from './components/Board.svelte';
  import BoardBadge from './components/BoardBadge.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import RegionOverlay from './components/RegionOverlay.svelte';
  import BoardControls from './components/BoardControls.svelte';
  import TurnToggle from './components/TurnToggle.svelte';
  import { isNarrow } from './lib/viewport';
  import EngineHeader from './components/EngineHeader.svelte';
  import Lines from './components/Lines.svelte';
  import MoveFeedback from './components/MoveFeedback.svelte';
  import MoveHistory from './components/MoveHistory.svelte';
  import EvalGraph from './components/EvalGraph.svelte';
  import MoveStepper from './components/MoveStepper.svelte';
  import HomePanel from './components/HomePanel.svelte';
  import EditPanel from './components/EditPanel.svelte';
  import GameReportSummary from './components/GameReportSummary.svelte';
  import ActionBar from './components/ActionBar.svelte';
  import Panel from './components/Panel.svelte';
  import Icon from './components/Icon.svelte';
  import { captureCommands, type Region } from '@chessmenthol/core/lib/region';
  import { hasNativeCapture } from './lib/capture';
  import { makePositionPgn, looksLikePgn } from '@chessmenthol/core/core/pgn';
  import { graphSeries } from '@chessmenthol/core/core/report';

  let orientation: 'white' | 'black' = 'white';
  let manualFlip = false;
  let selectedEditPiece: string | null = 'P';
  type Screen = 'home' | 'analysis' | 'edit' | 'report' | 'review';
  let screen: Screen = 'home';
  // Editor form state (initialized when entering the editor)
  let editSide: 'white' | 'black' = 'white';
  let editCastle: CastlingRights = { K: true, Q: true, k: true, q: true };
  let editFen = '';
  let viewPrefs: ViewPrefs = loadViewPrefs();
  let editError: string | null = null;
  let boardComp: Board;
  let lastReport: import('@chessmenthol/core/lib/types').GameReportDto | null = null;
  const hasCapture = hasNativeCapture(); // true inside Tauri; false in a plain browser
  let pickingRegion = false;
  // Capture failures (e.g. no screenshot tool, a Wayland env issue) come back as an
  // error frame with no region_shot. Surface it in the overlay instead of leaving a
  // perpetual "capturing…". pickSeq snapshots errorSeq at request time so we only
  // react to an error raised by THIS request, not a stale one from earlier.
  let captureError: string | null = null;
  let pickSeq = 0;
  function onPickRegion() {
    captureError = null;
    pickSeq = $errorSeq;
    regionShot.set(null);
    pickingRegion = true;
    send({ type: 'request_region_shot' });
  }
  $: if (pickingRegion && $errorSeq > pickSeq && $regionShot === null) captureError = $lastError;
  function onConfirmRegion(r: Region, side: 'auto' | 'white' | 'black') {
    pickingRegion = false;
    // Apply the chosen capture orientation BEFORE the capture fires. The region is
    // not set yet, so set_board_side only stores the tracker override (no capture);
    // captureCommands' set_region then runs the capture with it already applied.
    send({ type: 'set_board_side', side });
    for (const c of captureCommands(r)) send(c);
    enterAnalysis();
  }
  function onCancelRegion() { pickingRegion = false; captureError = null; }

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
    const trimmed = text.trim();
    if (trimmed) {
      if (looksLikePgn(trimmed)) send({ type: 'load_pgn', pgn: trimmed });
      else send({ type: 'set_fen', fen: trimmed });
    }
    enterAnalysis();
  }
  function onNew(): void {
    screen = 'home';
    manualFlip = false;
    lastReport = null;
    report.set(null);
    send({ type: 'set_analysis_enabled', enabled: false });
    send({ type: 'reset' });
  }
  function reportMatchesGame(
    r: import('@chessmenthol/core/lib/types').GameReportDto,
    st: import('@chessmenthol/core/lib/types').StateFrame | null,
  ): boolean {
    const a = r.plies.map((p) => p.uci);
    const b = (st?.moveList ?? []).map((m) => m.uci);
    return a.length === b.length && a.every((u, i) => u === b[i]);
  }

  function onRequestAnalysis(): void {
    if (rpt && reportMatchesGame(rpt, s)) { screen = 'report'; return; }
    send({ type: 'analyze_game' });
  }
  function onCancelAnalysis(): void { send({ type: 'cancel_analysis' }); }
  function onBackToAnalysis(): void {
    screen = 'analysis';
    // The orchestrator leaves _analyzing=false after the batch finishes/cancels;
    // re-enable live analysis so the board isn't silent after returning.
    send({ type: 'set_analysis_enabled', enabled: true });
  }
  function onStartReview(): void { onNavigate(0); screen = 'review'; }
  function onReviewBack(): void { screen = 'report'; }

  // ===== Review auto-play =====
  let playing = false;
  let playTimer: ReturnType<typeof setInterval> | null = null;
  function stopPlay(): void { playing = false; if (playTimer) { clearInterval(playTimer); playTimer = null; } }
  function togglePlay(): void {
    if (playing) { stopPlay(); return; }
    const total = s?.moveList?.length ?? 0;
    if ((s?.currentPly ?? 0) >= total) send({ type: 'navigate', index: 0 });
    playing = true;
    playTimer = setInterval(() => {
      const total2 = s?.moveList?.length ?? 0;
      const cur = s?.currentPly ?? 0;
      if (cur >= total2) { stopPlay(); return; }
      send({ type: 'navigate', index: cur + 1 });
    }, 1200);
  }
  // Any manual navigation (arrows, move click, eval-graph click) pauses auto-play.
  function reviewNavigate(ply: number): void { stopPlay(); onNavigate(ply); }
  onDestroy(stopPlay);
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
  $: editPgn = makePositionPgn(editFen);
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
  $: rpt = $report;
  $: progress = $reportProgress;
  // Auto-switch to the report screen when a NEW report arrives (identity guard
  // prevents re-switching back after the user clicks Back from the report screen).
  $: if (rpt && rpt !== lastReport) { lastReport = rpt; if (screen === 'analysis') screen = 'report'; }
  $: hasReportForGame = !!(rpt && reportMatchesGame(rpt, s));
  // Eval-graph series for the Review screen: base position + one point per ply,
  // each carrying win%, White-POV eval text, and a move label (for the hover tooltip).
  $: reviewSeries = rpt ? graphSeries(rpt) : [];
  $: reviewWins = reviewSeries.map((p) => p.win);
  $: reviewEvals = reviewSeries.map((p) => p.evalText);
  $: reviewLabels = reviewSeries.map((p) => p.label);
  $: reviewClasses = reviewSeries.map((p) => p.cls);
  // Leaving the review screen stops auto-play.
  $: if (screen !== 'review' && playing) stopPlay();
</script>

<div class="app">
  <main>
    <div class="board-col">
      <div class="board-wrap">
        {#if viewPrefs.evalBar && analysisEnabled}
          {#if $isNarrow}
            <div class="evalbar-h"><EvalBar horizontal evalDto={s?.eval ?? null} {orientation} gameOver={s?.gameOver ?? null} /></div>
          {:else}
            <div class="evalbar-slot"><EvalBar evalDto={s?.eval ?? null} {orientation} gameOver={s?.gameOver ?? null} /></div>
          {/if}
        {/if}
        <Board bind:this={boardComp} {fen} {orientation} {onMove} revertSignal={$errorSeq}
          lastMove={lastMoveUci}
          lines={s?.lines ?? []} showArrows={viewPrefs.arrows && analysisEnabled}
          {editing} {selectedEditPiece} onEdit={onBoardEdit} />
        {#if !editing}<BoardBadge lastMove={s?.lastMove ?? null} {orientation} />{/if}
        <!-- Analysis-only: Home is a clean start screen, and in Edit the EditPanel owns
             the side-to-move dropdown + its own flip, so the board-column turn/flip
             control would only duplicate them. -->
        {#if screen === 'analysis'}
          {#if $isNarrow}
            <div class="mobile-ctrls" data-testid="mobile-ctrls">
              <MoveStepper compact currentPly={s?.currentPly ?? 0} total={s?.moveList?.length ?? 0} {onNavigate} />
              <span class="ctrl-sep" aria-hidden="true"></span>
              <TurnToggle sideToMove={s?.sideToMove ?? 'white'} onSetTurn={(white) => send({ type: 'set_turn', white })} />
              <span class="ctrl-sep" aria-hidden="true"></span>
              <button type="button" class="flipbtn" data-testid="flip-btn-mobile" title="Flip board" on:click={onFlip}><Icon name="ChasingArrows" /></button>
            </div>
          {:else}
            <BoardControls sideToMove={s?.sideToMove ?? 'white'}
              onSetTurn={(white) => send({ type: 'set_turn', white })} onFlip={onFlip} />
          {/if}
        {/if}
      </div>
    </div>
    <div class="panel">
      {#if screen === 'home'}
        <HomePanel hasCapture={hasCapture} onSetUp={onSetUp} onExplore={onExplore}
          onCapture={onPickRegion} onStart={onStart} />
      {:else if screen === 'edit'}
        <EditPanel fen={editFen} side={editSide} castle={editCastle} selected={selectedEditPiece}
          pgn={editPgn} editError={editError}
          onSelect={onSelectPiece} onSide={onEditSide} onToggleCastle={onToggleCastle}
          onFlip={onFlip} onReset={onEditReset} onClear={onEditClear}
          onFenInput={onEditFenInput} onLoad={onEditLoad} onBack={onEditBack} />
      {:else if screen === 'report' && rpt}
        <GameReportSummary report={rpt} moveList={s?.moveList ?? []} currentPly={s?.currentPly ?? 0}
          {onNavigate} {onStartReview} {onBackToAnalysis} {onNew} />
      {:else if screen === 'review' && rpt}
        <Panel title="Computer Analysis" testid="review-card">
          <button slot="left" type="button" class="hbtn" data-testid="review-back"
            aria-label="Back to game report" on:click={onReviewBack}><Icon name="Back" /></button>
          {#if s?.lastMove || s?.annotating}
            <div class="sec" data-testid="feedback-section">
              <div class="bd">
                <MoveFeedback lastMove={s?.lastMove ?? null}
                  evaluating={s?.annotating && (s?.currentPly ?? 0) >= 1 ? { san: s.moveList[s.currentPly - 1]?.san ?? '' } : null}
                  onPlayBest={(uci) => send({ type: 'play_best', uci })}
                  gameOver={s?.gameOver ?? null} />
              </div>
            </div>
          {/if}
          <div class="sec grow">
            <MoveHistory moveList={s?.moveList ?? []} currentPly={s?.currentPly ?? 0} onNavigate={reviewNavigate} showBadges />
          </div>
          <div class="sec evalsec">
            <EvalGraph wins={reviewWins} evals={reviewEvals} labels={reviewLabels} classes={reviewClasses} currentPly={s?.currentPly ?? 0} onNavigate={reviewNavigate} />
          </div>
          <MoveStepper slot="footer" currentPly={s?.currentPly ?? 0} total={s?.moveList?.length ?? 0}
            onNavigate={reviewNavigate} {playing} onTogglePlay={togglePlay} />
        </Panel>
      {:else}
        <Panel title="Analysis" testid="analysis-card">
          <!-- Engine header + engine lines (one section) -->
          <!-- NOTE: EngineSettings search-time slider defaults to index 2 (10s), which already
               matches the backend default movetime (10s). Initializing the slider from s.movetime
               is deliberately deferred — defaults align and no prop plumbing is needed yet. -->
          <div class="sec">
            <EngineHeader
              {analysisEnabled}
              divider={showLines}
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

          <!-- Move feedback — hidden until there's a move to describe, so no empty divider -->
          {#if viewPrefs.feedback && analysisEnabled && (s?.lastMove || s?.annotating)}
            <div class="sec" data-testid="feedback-section">
              <div class="bd">
                <MoveFeedback lastMove={s?.lastMove ?? null}
                  evaluating={s?.annotating && (s?.currentPly ?? 0) >= 1 ? { san: s.moveList[s.currentPly - 1]?.san ?? '' } : null}
                  onPlayBest={(uci) => send({ type: 'play_best', uci })}
                  gameOver={s?.gameOver ?? null} />
              </div>
            </div>
          {/if}

          <!-- Move history (renders its own .movehist-sec; wrap in a growing .sec
               so the history list absorbs the card's remaining height and scrolls) -->
          <div class="sec grow">
            <MoveHistory moveList={s?.moveList ?? []} currentPly={s?.currentPly ?? 0}
              {onNavigate} />
          </div>

          <!-- Action bar (footer) -->
          <ActionBar slot="footer" currentPly={s?.currentPly ?? 0} total={s?.moveList?.length ?? 0}
            {onNavigate} onNew={onNew} narrow={$isNarrow}
            onRequestAnalysis={onRequestAnalysis} onCancelAnalysis={onCancelAnalysis}
            reportProgress={progress} {hasReportForGame} />
        </Panel>
      {/if}
    </div>
  </main>
  {#if pickingRegion && hasCapture}
    <RegionOverlay shot={$regionShot} error={captureError} onConfirm={onConfirmRegion} onCancel={onCancelRegion} onRetry={onPickRegion} />
  {/if}
</div>

<style>
  .app {
    width: 100%;
    max-width: 1320px;
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

  /* ===== card section dividers ===== */
  .bd { padding: 7px 10px; }
  .sec + .sec { border-top: 1px solid var(--keyline); }
  /* Only the move-history section grows to absorb the card's remaining height,
     letting its inner .movehist-sec (flex:1) and .movehist (overflow-y:auto) scroll. */
  .grow { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  /* The eval graph brings no padding of its own, so its review-card section needs it. */
  .evalsec { padding: 14px 16px; }

  /* ===== Narrow / mobile: single-column vertical stack ===== */
  .evalbar-h { margin-bottom: 8px; }
  .mobile-ctrls { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 12px; }
  .mobile-ctrls .ctrl-sep { width: 1px; height: 22px; background: var(--keyline-2); margin: 0 8px; flex: none; }
  .mobile-ctrls .flipbtn {
    width: 33px; height: 33px; display: grid; place-items: center;
    border: none; background: transparent; cursor: pointer; color: var(--ink-3); font-size: 18px;
  }
  .mobile-ctrls .flipbtn:hover { color: var(--green); }
  @media (pointer: coarse) { .mobile-ctrls .flipbtn { min-width: 40px; min-height: 40px; } }

  @media (max-width: 819.98px) {
    .app { height: auto; min-height: calc(100dvh - 40px); }
    main { flex-direction: column; align-items: stretch; gap: 12px; }
    /* Full-width column, but the board-wrap keeps `width: var(--bsize)` (narrowed
       in app.css to min(100vw - 20px, 66vh)) so the board is height-capped; center it. */
    .board-col { flex: initial; align-self: stretch; justify-content: center; }
    .panel { width: 100%; }
  }
</style>
