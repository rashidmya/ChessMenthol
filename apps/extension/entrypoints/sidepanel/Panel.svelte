<script lang="ts">
  import Board from './components/Board.svelte';
  import EvalBar from './components/EvalBar.svelte';
  import Lines from './components/Lines.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { createPanelClient, applyPosition } from '../../src/lib/panelClient';
  import { loadWasmEngine } from '../../src/engine/wasmEngine';
  import { makeTabTracker } from '../../src/vision/visionTracker';
  import { isPositionMessage, type ExtMessage, type CaptureResult, type PositionMessage } from '../../src/lib/messages';
  import { getMyWindowId, requestPosition, isFromActiveTab, onActiveTabChanged, type SenderLike, type TabsApi } from '../../src/lib/activeTab';
  import { settings, hydrateSettings, patchSettings } from '../../src/lib/settings';
  import { settingsToCommands } from '../../src/lib/settingsToCommands';
  import { panelStatus } from '../../src/lib/panelStatus';
  import SourceBadge from './SourceBadge.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import TurnToggle from './TurnToggle.svelte';
  import { browser } from 'wxt/browser';

  async function requestCapture(): Promise<string> {
    const res = (await browser.runtime.sendMessage({ kind: 'capture-request' })) as CaptureResult | undefined;
    if (!res?.dataUrl) throw new Error(res?.error ?? 'screen capture failed');
    return res.dataUrl;
  }

  const tracker = makeTabTracker(requestCapture);
  const client = createPanelClient(loadWasmEngine, tracker);
  const panelState = client.state;
  const lastError = client.lastError;
  const s = settings;

  const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let fenInput = STARTPOS;
  let revertSignal = 0;
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
  // refocus, tab re-activation, Capture on an unchanged board) must not restart the search
  // or wipe the panel's history — only a genuinely new site position replaces it.
  let lastSiteFen: string | null = null;

  $: currentFen = $panelState?.fen ?? STARTPOS;
  // The orchestrator's analysisEnabled is the single source of truth for the toggle —
  // no local flag to drift from the engine's actual state.
  $: analyzing = $panelState?.analysisEnabled ?? false;
  $: if (source === 'vision' && $panelState?.detectedOrientation) boardOrientation = $panelState.detectedOrientation;

  // Re-send engine-affecting settings only when lines/time change (an arrows/toggle
  // flip must NOT restart the search).
  let lastEngineKey = '';
  $: {
    const key = `${$s.lines}|${$s.thinkingMs}`;
    if (key !== lastEngineKey) { lastEngineKey = key; for (const c of settingsToCommands($s)) client.send(c); }
  }

  function maybeAnalyze() {
    if ($s.autoAnalyze) client.send({ type: 'set_analysis_enabled', enabled: true });
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
  function captureNow() {
    source = 'vision'; adapterOk = true; lastSiteFen = null; lastError.set(null);
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

  /** Ask the active tab for its board; true when a position came back and was applied. */
  async function pullPosition(): Promise<boolean> {
    const seq = ++pullSeq;
    const pos = await requestPosition(tabsApi, myWindowId);
    if (seq !== pullSeq || destroyed) return false;   // a newer pull superseded this one
    if (pos) applyIncoming(pos);
    return pos !== null;
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
  $: status = panelStatus({ lastError: $lastError, visionStatus: $panelState?.visionStatus, adapterOk });
  $: lowConfidence = $panelState?.visionStatus === 'low_confidence';

  const STATUS_TEXT: Record<string, { msg: string; action?: 'capture' }> = {
    engine_unavailable: { msg: 'Analysis engine unavailable. Board reconstruction still works.' },
    capture_denied: { msg: "Couldn't capture this page (try a normal web page and click again).", action: 'capture' },
    adapter_broke: { msg: "Can't read this site's board — capture it instead.", action: 'capture' },
    no_board: { msg: 'No chessboard detected. Make the board fully visible and try again.', action: 'capture' },
    unreadable: { msg: "Board found but the pieces couldn't be read — wait for the move animation to finish and try again.", action: 'capture' },
  };
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
        {#if STATUS_TEXT[status].action === 'capture'}
          <button data-testid="status-capture" on:click={captureNow}>Capture screen</button>
        {/if}
      </div>
    {/if}

    <div class="board-row">
      <EvalBar {evalDto} orientation={boardOrientation} />
      <Board fen={currentFen} orientation={boardOrientation} {lines} showArrows={$s.arrows}
        onMove={() => { revertSignal += 1; }} {revertSignal} />
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

    <div class="evalcard">
      <div class="evaltop">
        <span class="score" data-testid="eval-readout">{evalDto?.text ?? '0.0'}</span>
        <span class="meta">{analyzing ? `depth ${depth}` : 'idle'}{lines[0] ? ` · best ${lines[0].san.split(' ')[0]}` : ''}</span>
      </div>
      <Lines {lines} />
    </div>

    <div class="controls">
      <button data-testid="analyze" on:click={toggleAnalysis}>{analyzing ? 'Stop' : 'Analyze'}</button>
      <button data-testid="capture" on:click={captureNow}>Capture</button>
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
  .ribbon { margin: 0; font-size: 11px; color: #c93; }
  .fen { font: 11px/1.3 monospace; color: #888; word-break: break-all; margin: 0; }
</style>
