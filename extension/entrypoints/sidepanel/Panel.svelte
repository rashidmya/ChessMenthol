<script lang="ts">
  import Board from '@core/components/Board.svelte';
  import EvalBar from '@core/components/EvalBar.svelte';
  import Lines from '@core/components/Lines.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { createPanelClient, applyPosition } from '../../src/lib/panelClient';
  import { loadWasmEngine } from '../../src/engine/wasmEngine';
  import { makeTabTracker } from '../../src/vision/visionTracker';
  import { isPositionMessage, type ExtMessage, type CaptureResult } from '../../src/lib/messages';
  import { browser } from 'wxt/browser';

  // Ask the background to capture the visible tab; resolve to a PNG data URL (or null).
  // The background (not the panel) has the tab context + `activeTab` grant.
  async function requestCapture(): Promise<string | null> {
    const res = (await browser.runtime.sendMessage({ kind: 'capture-request' })) as CaptureResult | undefined;
    return res?.dataUrl ?? null;
  }

  // In a jsdom test the real worker never loads; createPanelClient only calls
  // load() when analysis is enabled, so mounting stays engine-free.
  const tracker = makeTabTracker(requestCapture);
  const client = createPanelClient(loadWasmEngine, tracker);
  // Named panelState (not `state`) to avoid confusion with Svelte 5's `$state`
  // rune — this file uses the legacy API and has no runes.
  const panelState = client.state;
  const lastError = client.lastError; // engine/load failures (e.g. a wasm CSP block)

  let fenInput = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let currentFen = fenInput;
  let analyzing = false;
  // Plan 1's only position source is the FEN input. Board is draggable by default;
  // bumping revertSignal on any drag makes it snap back to currentFen (no make_move).
  let revertSignal = 0;

  // Plan 2: where the current position came from, and the board orientation it
  // arrived with. Manual FEN entry always resets to 'manual' + white.
  let source: 'manual' | 'chesscom' | 'lichess' = 'manual';
  let boardOrientation: 'white' | 'black' = 'white';

  function loadFen() {
    source = 'manual';
    currentFen = fenInput.trim();
    client.send({ type: 'set_fen', fen: currentFen });
    if (analyzing) client.send({ type: 'set_analysis_enabled', enabled: true });
  }
  function toggleAnalysis() {
    analyzing = !analyzing;
    client.send({ type: 'set_analysis_enabled', enabled: analyzing });
  }
  function captureNow() {
    source = 'manual';           // vision-derived; not a live DOM source
    analyzing = true;
    client.send({ type: 'set_analysis_enabled', enabled: true });
    client.send({ type: 'capture_now' });
  }

  function onMessage(msg: ExtMessage) {
    if (!isPositionMessage(msg)) return;
    source = msg.site;
    currentFen = msg.fen;
    boardOrientation = msg.orientation;
    analyzing = true;
    applyPosition(client.send, msg);
  }

  onMount(() => browser?.runtime?.onMessage?.addListener?.(onMessage));
  onDestroy(() => browser?.runtime?.onMessage?.removeListener?.(onMessage));

  // StateFrame carries eval/lines directly (there is no `.analysis`).
  $: evalDto = $panelState?.eval ?? null;
  $: lines = $panelState?.lines ?? [];
</script>

<main class="panel">
  <div class="board-row">
    <EvalBar {evalDto} orientation={boardOrientation} />
    <!-- Board.svelte renders its own <div data-testid="board">; don't wrap it in a
         second one or getByTestId('board') matches two elements. -->
    <Board fen={currentFen} orientation={boardOrientation} {lines} onMove={() => { revertSignal += 1; }} {revertSignal} />
  </div>

  <div class="controls">
    <input data-testid="fen-input" bind:value={fenInput} placeholder="Paste a FEN" />
    <button data-testid="load-fen" on:click={loadFen}>Load</button>
    <button data-testid="analyze" on:click={toggleAnalysis}>{analyzing ? 'Stop' : 'Analyze'}</button>
    <button data-testid="capture" on:click={captureNow}>Capture screen</button>
  </div>

  <p data-testid="current-fen" class="fen">{currentFen}</p>
  <p data-testid="source" class="source">Source: {source}</p>
  {#if $lastError}<p class="err" data-testid="panel-error">{$lastError}</p>{/if}
  <Lines {lines} />
</main>

<style>
  .panel { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .board-row { display: flex; gap: 6px; }
  .controls { display: flex; gap: 6px; }
  .controls input { flex: 1; }
  .fen { font: 11px/1.3 monospace; color: #888; word-break: break-all; }
  .source { margin: 0; font-size: 11px; color: #888; }
  .err { margin: 0; color: #c33; font-size: 12px; }
</style>
