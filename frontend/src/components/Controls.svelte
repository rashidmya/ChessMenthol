<script lang="ts">
  import type { Command } from '../lib/types';
  export let sideToMove: 'white' | 'black' = 'white';
  export let engineId = 'stockfish';
  export let analyzing = true;
  export let fen = '';
  export let onCommand: (cmd: Command) => void = () => {};
  export let onFlip: () => void = () => {};
  export let tracking: boolean = false;
  export let visionStatus: string = 'off';
  export let lowConfidence: string[] = [];
  export let editing: boolean = false;
  export let showArrows: boolean = true;
  export let showEvalBar: boolean = true;
  export let onToggleEdit: () => void = () => {};
  export let onToggleArrows: () => void = () => {};
  export let onToggleEvalBar: () => void = () => {};

  let fenInput = fen;
  let lines = 3;
  let depth = 18;
  let threads = 2;
  let hashMb = 256;
  function setThreads(e: Event) {
    threads = Number((e.target as HTMLInputElement).value);
    onCommand({ type: 'set_options', threads });
  }
  function setHash(e: Event) {
    hashMb = Number((e.target as HTMLInputElement).value);
    onCommand({ type: 'set_options', hash: hashMb });
  }

  function setTurn(white: boolean) { onCommand({ type: 'set_turn', white }); }
  function setEngine(e: Event) {
    onCommand({ type: 'set_engine', id: (e.target as HTMLSelectElement).value });
  }
  function setLines(e: Event) {
    lines = Number((e.target as HTMLInputElement).value);
    onCommand({ type: 'set_options', multipv: lines });
  }
  function setDepth(e: Event) {
    depth = Number((e.target as HTMLInputElement).value);
    onCommand({ type: 'set_options', depth });
  }
  function applyFen() { onCommand({ type: 'set_fen', fen: fenInput }); }
</script>

<div class="controls">
  <section class="csec">
    <div class="clab">◉ Source</div>
    <div class="btns">
      <button data-testid="auto-btn" aria-pressed={tracking}
        class:on={tracking}
        on:click={() => onCommand({ type: 'set_auto', on: !tracking })}>Auto ●</button>
      <button data-testid="capture-btn"
        on:click={() => onCommand({ type: 'capture_now' })}>Capture</button>
      <button data-testid="region-btn" disabled>Region</button>
    </div>
    <span class="vision-status" data-testid="vision-status">
      {#if visionStatus === 'tracking'}tracking ●
      {:else if visionStatus === 'low_confidence'}● {lowConfidence.length} uncertain
      {:else if visionStatus === 'searching'}searching…
      {:else}—{/if}
    </span>
  </section>

  <section class="csec">
    <div class="clab">👁 Display</div>
    <div class="btns">
      <label>Lines
        <input data-testid="lines-input" type="number" min="1" max="5"
          value={lines} on:change={setLines} />
      </label>
      <label>Depth
        <input data-testid="depth-input" type="number" min="1" max="40"
          value={depth} on:change={setDepth} />
      </label>
      <button data-testid="stop-btn" on:click={() => onCommand({ type: 'stop' })}>
        {analyzing ? 'Stop' : 'Stopped'}
      </button>
      <button data-testid="arrows-toggle" aria-pressed={showArrows} class:on={showArrows}
        on:click={onToggleArrows}>Arrows</button>
      <button data-testid="eval-toggle" aria-pressed={showEvalBar} class:on={showEvalBar}
        on:click={onToggleEvalBar}>Eval bar</button>
    </div>
  </section>

  <section class="csec">
    <div class="clab">♟ Position</div>
    <div class="btns">
      <span class="turn">
        <button data-testid="turn-white" class:on={sideToMove === 'white'}
          on:click={() => setTurn(true)}>White</button>
        <button data-testid="turn-black" class:on={sideToMove === 'black'}
          on:click={() => setTurn(false)}>Black</button>
      </span>
      <button data-testid="flip-btn" on:click={onFlip}>Flip</button>
      <button data-testid="undo-btn" on:click={() => onCommand({ type: 'undo' })}>Undo</button>
      <button data-testid="edit-btn" class:on={editing} on:click={onToggleEdit}>
        {editing ? 'Done' : 'Edit'}
      </button>
    </div>
    <div class="btns">
      <input data-testid="fen-input" class="fen" placeholder="paste FEN" bind:value={fenInput} />
      <button data-testid="fen-set" on:click={applyFen}>Set</button>
    </div>
  </section>

  <section class="csec">
    <div class="clab">⚙ Engine</div>
    <div class="btns">
      <select data-testid="engine-select" value={engineId} on:change={setEngine}>
        <option value="stockfish">Stockfish</option>
        <option value="stockfish_lite">Stockfish Lite</option>
      </select>
      <label>Threads
        <input data-testid="threads-input" type="number" min="1" max="32"
          value={threads} on:change={setThreads} />
      </label>
      <label>Hash
        <input data-testid="hash-input" type="number" min="16" max="4096" step="16"
          value={hashMb} on:change={setHash} />
      </label>
    </div>
  </section>
</div>

<style>
  .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .csec { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px; padding: 8px; }
  .clab { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.55;
    margin-bottom: 6px; }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 4px; }
  button { font-size: 11px; padding: 4px 8px; border-radius: 5px; cursor: pointer;
    background: rgba(255,255,255,0.1); color: inherit; border: 1px solid rgba(255,255,255,0.15); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .turn button.on { background: rgba(17,162,107,0.3); border-color: #11a26b; }
  .fen { flex: 1; min-width: 120px; font-size: 11px; padding: 4px; }
  .vision-status { font-size: 9px; opacity: 0.7; }
  button.on { background: rgba(17,162,107,0.3); border-color: #11a26b; }
  input[type='number'] { width: 48px; }
</style>
