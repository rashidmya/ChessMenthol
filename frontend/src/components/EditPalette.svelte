<script lang="ts">
  // Lichess "cburnett" piece SVGs (the same set chessground renders on the board),
  // decoded from chessground.cburnett.css into src/assets/pieces/cburnett/.
  import wP from '../assets/pieces/cburnett/wP.svg';
  import wN from '../assets/pieces/cburnett/wN.svg';
  import wB from '../assets/pieces/cburnett/wB.svg';
  import wR from '../assets/pieces/cburnett/wR.svg';
  import wQ from '../assets/pieces/cburnett/wQ.svg';
  import wK from '../assets/pieces/cburnett/wK.svg';
  import bP from '../assets/pieces/cburnett/bP.svg';
  import bN from '../assets/pieces/cburnett/bN.svg';
  import bB from '../assets/pieces/cburnett/bB.svg';
  import bR from '../assets/pieces/cburnett/bR.svg';
  import bQ from '../assets/pieces/cburnett/bQ.svg';
  import bK from '../assets/pieces/cburnett/bK.svg';
  import Icon from './Icon.svelte';

  export let selected: string | null = 'P';
  export let onSelect: (tok: string) => void = () => {};

  const TOKENS = ['P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'];
  const IMG: Record<string, string> = {
    P: wP, N: wN, B: wB, R: wR, Q: wQ, K: wK,
    p: bP, n: bN, b: bB, r: bR, q: bQ, k: bK,
  };
  const NAME: Record<string, string> = {
    p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
  };
  const label = (t: string) => (t === t.toUpperCase() ? 'White ' : 'Black ') + NAME[t.toLowerCase()];
</script>

<div class="palette" data-testid="edit-palette">
  <div class="grid">
    {#each TOKENS as tok}
      <button type="button" data-testid={'pal-' + tok} class="pc" class:on={selected === tok}
        on:click={() => onSelect(tok)} title={label(tok)} aria-label={label(tok)}>
        <img src={IMG[tok]} alt={label(tok)} draggable="false" />
      </button>
    {/each}
  </div>
  <button type="button" data-testid="pal-trash" class="eraser" class:on={selected === 'trash'}
    on:click={() => onSelect('trash')} title="Erase squares" aria-label="Erase squares">
    <span class="eico"><Icon name="Trash" /></span> Erase
  </button>
</div>

<style>
  .palette { display: flex; flex-direction: column; gap: 8px; }
  .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
  .pc {
    aspect-ratio: 1; display: grid; place-items: center; padding: 5px;
    background: var(--paper-2); border: 1px solid var(--keyline-2); border-radius: 9px;
    cursor: pointer; transition: .14s;
  }
  .pc:hover { border-color: var(--green); background: #fff; }
  .pc.on { border-color: var(--green); background: #fff; box-shadow: 0 0 0 2px rgba(47,93,58,.25); }
  .pc img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .eraser {
    display: flex; align-items: center; justify-content: center; gap: 8px; padding: 11px;
    font-family: var(--sans); font-weight: 600; font-size: 13px; color: var(--ink-3);
    background: var(--paper-2); border: 1px solid var(--keyline-2); border-radius: 9px;
    cursor: pointer; transition: .14s;
  }
  .eraser:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .eraser.on { border-color: var(--green); color: var(--green); background: #fff; box-shadow: 0 0 0 2px rgba(47,93,58,.25); }
  .eico { font-size: 15px; }
</style>
