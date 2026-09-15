<script lang="ts">
  import Board from './components/Board.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import Lines from './components/Lines.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { createPanelClient, applyPosition } from '../../src/lib/panelClient';
  import { loadWasmEngine } from '../../src/engine/wasmEngine';
  import { makeTabTracker } from '../../src/vision/visionTracker';
  import { isPositionMessage, type ExtMessage, type CaptureRequest, type CaptureResult, type PositionMessage } from '../../src/lib/messages';
  import { getMyWindowId, requestPosition, isFromActiveTab, onActiveTabChanged, type SenderLike, type TabsApi } from '../../src/lib/activeTab';
  import { settings, hydrateSettings, patchSettings } from '../../src/lib/settings';
  import { settingsToCommands } from '../../src/lib/settingsToCommands';
  import { panelStatus } from '../../src/lib/panelStatus';
  import { STATUS_TEXT } from '../../src/lib/statusText';
  import SourceBadge from './SourceBadge.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import TurnToggle from './TurnToggle.svelte';
  import MoveStepper from './MoveStepper.svelte';
  import MoveList from './MoveList.svelte';
  import { currentLastMoveUci } from '@chessmenthol/core/lib/board';
  import { browser } from 'wxt/browser';

  async function requestCapture(): Promise<string> {
    // `myWindowId` (declared below) is read at call time, never at definition.
    const req: CaptureRequest = { kind: 'capture-request', windowId: myWindowId ?? undefined };
    const res = (await browser.runtime.sendMessage(req)) as CaptureResult | undefined;
    if (!res?.dataUrl) throw new Error(res?.error ?? 'screen capture failed');
    return res.dataUrl;
  }

  const tracker = makeTabTracker(requestCapture);
  const busy = tracker.busy;
  const client = createPanelClient(loadWasmEngine, tracker);
  const panelState = client.state;
  const lastError = client.lastError;
  const errorSeq = client.errorSeq;
  const s = settings;

  const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let fenInput = STARTPOS;
  let view: 'analysis' | 'settings' = 'analysis';
  let showFen = false;
  let source: 'manual' | 'vision' | 'chesscom' | 'lichess' = 'manual';
  let boardOrientation: 'white' | 'black' = 'white';
  let adapterOk = true;

  // Tab affinity: only the active tab of THIS window may drive the panel. null = unknown
  // (plain-browser dev / tests) -> no filtering.
  let myWindowId: number | null = null;
  let unsubTab: () => void = () => {};
  let destroyed = false;
  const tabsApi: TabsApi = browser;
  // Bumped per pull so an older in-flight request (quick tab switches) can't land after
  // a newer one and overwrite the current tab's board with a stale reply.
  let pullSeq = 0;
  // The FEN last received from the site. A re-read that returns the same position (window
  // refocus, tab re-activation) must not restart the search or wipe the panel's history —
  // only a genuinely new site position replaces it. An explicit Capture clears this first.
  // Known edge: a NEW game that starts at the very same position (the content driver resets
  // its dedupe on board replacement and pushes it) is swallowed here too, so a manual line
  // survives until that game's first move. Proper fix: a board-generation token on
  // PositionMessage (follow-up).
  let lastSiteFen: string | null = null;

  $: currentFen = $panelState?.fen ?? STARTPOS;
  // The orchestrator's analysisEnabled is the single source of truth for the toggle —
  // no local flag to drift from the engine's actual state.
  $: analyzing = $panelState?.analysisEnabled ?? false;
  $: if (source === 'vision' && $panelState?.detectedOrientation) boardOrientation = $panelState.detectedOrientation;
  $: moveList = $panelState?.moveList ?? [];
  $: currentPly = $panelState?.currentPly ?? 0;
  // Yellow last-move highlight from authoritative state so it follows the stepper.
  $: lastMoveUci = currentLastMoveUci(moveList, currentPly);

  // Re-send engine-affecting settings only when lines/time change (an arrows/toggle
  // flip must NOT restart the search).
  let lastEngineKey = '';
  $: {
    const key = `${$s.lines}|${$s.thinkingMs}`;
    if (key !== lastEngineKey) { lastEngineKey = key; for (const c of settingsToCommands($s)) client.send(c); }
  }

  function maybeAnalyze() {
    // Only flip the switch when it is off: the orchestrator already restarts the search
    // for a new position on make_move / set_fen / capture, so re-sending `enabled: true`
    // would stop and relaunch the same search.
    if ($s.autoAnalyze && !$panelState?.analysisEnabled) client.send({ type: 'set_analysis_enabled', enabled: true });
  }
  function loadFen() {
    source = 'manual'; boardOrientation = 'white'; adapterOk = true; lastSiteFen = null;
    lastError.set(null);
    client.send({ type: 'set_fen', fen: fenInput.trim() });
    maybeAnalyze();
  }
  function toggleAnalysis() {
    client.send({ type: 'set_analysis_enabled', enabled: !analyzing });
  }
  /** A drag on the panel board: play it in the core (legal-only; chessground already
   *  filtered), which flips the turn, truncates any forward line and re-analyzes. The
   *  panel has now diverged from whatever site fed it — the badge says so — until the
   *  next NEW site position (a set_fen) replaces the history; a re-read of the same
   *  site position is ignored by the lastSiteFen guard so the line survives. */
  function onBoardMove(uci: string) {
    source = 'manual';
    client.send({ type: 'make_move', uci });
    maybeAnalyze();
  }
  function onNavigate(index: number) { client.send({ type: 'navigate', index }); }
  /** Capture = "read the board now". On chess.com / lichess the site's DOM is the reliable
   *  source, so ask the active tab first; screenshot + vision only when no site position
   *  came back (any other page, or an adapter that can't parse this board). An explicit
   *  Capture always re-applies, even an unchanged site position (bypasses the same-FEN
   *  guard) — the user asked for a re-read. */
  async function captureNow() {
    if ($busy) return;
    adapterOk = true; lastError.set(null); lastSiteFen = null;
    if (await pullPosition() !== 'none') return;
    source = 'vision';
    client.send({ type: 'capture_now' });
    maybeAnalyze();
  }

  /** Apply a site position (pushed or requested) — the one path all sources share. */
  function applyIncoming(msg: PositionMessage) {
    adapterOk = true; boardOrientation = msg.orientation; lastError.set(null);
    if (msg.fen === lastSiteFen) return;
    lastSiteFen = msg.fen; source = msg.site;
    if ($s.autoAnalyze) applyPosition(client.send, msg);
    else client.send({ type: 'set_fen', fen: msg.fen });
  }

  /** Ask the active tab for its board. 'applied' = a position came back and was applied;
   *  'none' = no site position there (fall back to vision); 'superseded' = a newer pull
   *  or unmount won, so do nothing (in particular, do NOT fall back to a screenshot). */
  async function pullPosition(): Promise<'applied' | 'none' | 'superseded'> {
    const seq = ++pullSeq;
    const pos = await requestPosition(tabsApi, myWindowId);
    if (seq !== pullSeq || destroyed) return 'superseded';
    if (pos) { applyIncoming(pos); return 'applied'; }
    return 'none';
  }

  function onMessage(msg: ExtMessage, sender?: SenderLike) {
    if (!isFromActiveTab(sender, myWindowId)) return;
    if (msg?.kind === 'adapter-status') { if ($s.liveSiteReading) adapterOk = msg.ok; return; }
    if (!isPositionMessage(msg)) return;
    if (!$s.liveSiteReading) return;
    applyIncoming(msg);
  }

  function setLiveReading(on: boolean) {
    patchSettings({ liveSiteReading: on });
    if (on) void pullPosition();
  }

  onMount(() => {
    browser?.runtime?.onMessage?.addListener?.(onMessage);
    void (async () => {
      await hydrateSettings();
      if (destroyed) return;
      myWindowId = await getMyWindowId(tabsApi);
      if (destroyed) return;
      if (myWindowId !== null) {
        unsubTab = onActiveTabChanged(tabsApi, myWindowId, () => { if ($s.liveSiteReading) void pullPosition(); });
      }
      // Pushes only happen on CHANGE, so a panel opened mid-game must ask.
      if ($s.liveSiteReading) await pullPosition();
    })();
  });
  onDestroy(() => { destroyed = true; browser?.runtime?.onMessage?.removeListener?.(onMessage); unsubTab(); });

  $: evalDto = $panelState?.eval ?? null;
  $: lines = $panelState?.lines ?? [];
  $: depth = $panelState?.depth ?? 0;
  // visionStatus is written only by vision captures and never reset by set_fen, so gate it
  // on provenance: a no_board/unreadable card (or the low-confidence ribbon) from an earlier
  // screenshot must not linger over a later site/manual position.
  $: status = panelStatus({ lastError: $lastError, visionStatus: source === 'vision' ? $panelState?.visionStatus : undefined, adapterOk });
  $: lowConfidence = source === 'vision' && $panelState?.visionStatus === 'low_confidence';
</script>

<main class="panel">
  <header class="hdr">
    <span class="title">ChessMenthol</span>
    <SourceBadge {source} sideToMove={$panelState?.sideToMove ?? 'white'} />
    <button class="gear" data-testid="gear" aria-label="Settings"
      on:click={() => (view = view === 'settings' ? 'analysis' : 'settings')}>{view === 'settings' ? '✕' : '⚙'}</button>
  </header>

  {#if view === 'settings'}
    <SettingsPanel />
  {:else}
    {#if status !== 'analysis'}
      <div class="status" data-testid="status-card">
        <p>{STATUS_TEXT[status].msg}</p>
        {#if status === 'capture_denied' && $lastError}<p class="reason" data-testid="status-reason">{$lastError.replace(/^capture failed:\s*/i, '')}</p>{/if}
        {#if STATUS_TEXT[status].action === 'capture'}
          <button data-testid="status-capture" disabled={$busy} on:click={captureNow}>{$busy ? 'Capturing…' : 'Capture screen'}</button>
        {/if}
      </div>
    {/if}

    <div class="board-row">
      <EvalBar {evalDto} orientation={boardOrientation} />
      <Board fen={currentFen} orientation={boardOrientation} {lines} showArrows={$s.arrows}
        onMove={onBoardMove} revertSignal={$errorSeq} lastMove={lastMoveUci} />
    </div>
    {#if lowConfidence}<p class="ribbon" data-testid="low-confidence">Low-confidence read — double-check the pieces.</p>{/if}

    <div class="tools">
      <span class="tool">
        <TurnToggle sideToMove={$panelState?.sideToMove ?? 'white'}
          onSetTurn={(white) => client.send({ type: 'set_turn', white })} />
        <span class="tlabel">{($panelState?.sideToMove ?? 'white') === 'white' ? 'White' : 'Black'} to move</span>
      </span>
      <label class="tool">
        <input type="checkbox" data-testid="toggle-live-main" checked={$s.liveSiteReading}
          on:change={() => setLiveReading(!$s.liveSiteReading)} />
        <span class="tlabel">Live site reading</span>
      </label>
    </div>

    {#if moveList.length > 0}
      <div class="history">
        <MoveList {moveList} {currentPly} {onNavigate} />
        <MoveStepper {currentPly} total={moveList.length} {onNavigate} />
      </div>
    {/if}

    <div class="evalcard">
      <div class="evaltop">
        <span class="score" data-testid="eval-readout">{evalDto?.text ?? '0.0'}</span>
        <span class="meta">{analyzing ? `depth ${depth}` : 'idle'}{lines[0] ? ` · best ${lines[0].san.split(' ')[0]}` : ''}</span>
      </div>
      <Lines {lines} />
    </div>

    <div class="controls">
      <button data-testid="analyze" on:click={toggleAnalysis}>{analyzing ? 'Stop' : 'Analyze'}</button>
      <button data-testid="capture" disabled={$busy} on:click={captureNow}>{$busy ? 'Capturing…' : 'Capture'}</button>
      <button data-testid="fen-toggle" on:click={() => (showFen = !showFen)}>FEN</button>
    </div>

    {#if showFen}
      <div class="fenbox">
        <input data-testid="fen-input" bind:value={fenInput} placeholder="Paste a FEN" />
        <button data-testid="load-fen" on:click={loadFen}>Load</button>
      </div>
    {/if}

    <p data-testid="current-fen" class="fen">{currentFen}</p>
  {/if}
</main>

<style>
  .panel { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .hdr { display: flex; align-items: center; gap: 8px; }
  .hdr .title { font-weight: 700; }
  .hdr .gear { margin-left: auto; background: transparent; border: none; font-size: 16px; cursor: pointer; color: inherit; }
  .board-row { display: flex; gap: 6px; }
  .tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .tool { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
  .tool input { margin: 0; }
  .tlabel { opacity: .85; }
  .history { display: flex; flex-direction: column; gap: 6px; }
  .evalcard { border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .evaltop { display: flex; justify-content: space-between; align-items: baseline; }
  .evaltop .score { font-size: 20px; font-weight: 700; }
  .evaltop .meta { font-size: 11px; opacity: .6; }
  .controls { display: flex; gap: 6px; }
  .controls button { flex: 1; }
  .fenbox { display: flex; gap: 6px; }
  .fenbox input { flex: 1; }
  .status { border: 1px dashed #6a5; border-radius: 8px; padding: 10px; font-size: 12px;
    background: rgba(120,150,90,.10); display: flex; flex-direction: column; gap: 8px; }
  .reason { margin: 0; font: 10px/1.3 monospace; opacity: .7; word-break: break-word; }
  .ribbon { margin: 0; font-size: 11px; color: #c93; }
  .fen { font: 11px/1.3 monospace; color: #888; word-break: break-all; margin: 0; }
</style>
