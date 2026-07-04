<script lang="ts">
  import Board from '@core/components/Board.svelte';
  import EvalBar from '@core/components/EvalBar.svelte';
  import Lines from '@core/components/Lines.svelte';
  import { createPanelClient } from '../../src/lib/panelClient';
  import { loadWasmEngine } from '../../src/engine/wasmEngine';

  // In a jsdom test the real worker never loads; createPanelClient only calls
  // load() when analysis is enabled, so mounting stays engine-free.
  const client = createPanelClient(loadWasmEngine);
  // Named panelState (not `state`) to avoid confusion with Svelte 5's `$state`
  // rune — this file uses the legacy API and has no runes.
  const panelState = client.state;

  let fenInput = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let currentFen = fenInput;
  let analyzing = false;
  // Plan 1's only position source is the FEN input. Board is draggable by default;
  // bumping revertSignal on any drag makes it snap back to currentFen (no make_move).
  let revertSignal = 0;

  function loadFen() {
    currentFen = fenInput.trim();
    client.send({ type: 'set_fen', fen: currentFen });
    if (analyzing) client.send({ type: 'set_analysis_enabled', enabled: true });
  }
  function toggleAnalysis() {
    analyzing = !analyzing;
    client.send({ type: 'set_analysis_enabled', enabled: analyzing });
  }

  // StateFrame carries eval/lines directly (there is no `.analysis`). Board
  // orientation is fixed to White in Plan 1 (vision-driven orientation is Plan 2).
  const orientation: 'white' | 'black' = 'white';
  $: evalDto = $panelState?.eval ?? null;
  $: lines = $panelState?.lines ?? [];
</script>

<main class="panel">
  <div class="board-row">
    <EvalBar {evalDto} {orientation} />
    <!-- Board.svelte renders its own <div data-testid="board">; don't wrap it in a
         second one or getByTestId('board') matches two elements. -->
    <Board fen={currentFen} {orientation} {lines} onMove={() => { revertSignal += 1; }} {revertSignal} />
  </div>

  <div class="controls">
    <input data-testid="fen-input" bind:value={fenInput} placeholder="Paste a FEN" />
    <button data-testid="load-fen" on:click={loadFen}>Load</button>
    <button data-testid="analyze" on:click={toggleAnalysis}>{analyzing ? 'Stop' : 'Analyze'}</button>
  </div>

  <p data-testid="current-fen" class="fen">{currentFen}</p>
  <Lines {lines} />
</main>

<style>
  .panel { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .board-row { display: flex; gap: 6px; }
  .controls { display: flex; gap: 6px; }
  .controls input { flex: 1; }
  .fen { font: 11px/1.3 monospace; color: #888; word-break: break-all; }
</style>
