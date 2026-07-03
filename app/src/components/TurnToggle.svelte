<script lang="ts">
  import wPawn from '../assets/pieces/cburnett/wP.svg';
  import bPawn from '../assets/pieces/cburnett/bP.svg';
  export let sideToMove: 'white' | 'black' = 'white';
  export let onSetTurn: (white: boolean) => void = () => {};
  $: black = sideToMove === 'black';
</script>

<button
  type="button"
  class="turn-toggle"
  class:black
  data-testid="turn-toggle"
  role="switch"
  aria-checked={black}
  aria-label={black ? 'Black to move' : 'White to move'}
  title="Whose move — tap to toggle"
  on:click={() => onSetTurn(black)}
>
  <span class="knob"><img src={black ? bPawn : wPawn} alt="" /></span>
</button>

<style>
  .turn-toggle {
    position: relative;
    width: 52px;
    height: 28px;
    border-radius: 15px;
    background: var(--keyline, #e0dacb);
    border: 1px solid var(--keyline-2, #cfc7b3);
    box-shadow: inset 0 1px 3px rgba(40, 30, 15, 0.16);
    cursor: pointer;
    padding: 0;
    flex: none;
    transition: background 0.2s, border-color 0.2s;
  }
  .turn-toggle.black {
    background: #26221c;
    border-color: #120f0a;
    box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.55);
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fbf9f4;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(0, 0, 0, 0.05);
    display: grid;
    place-items: center;
    transition: left 0.2s;
  }
  .turn-toggle.black .knob { left: calc(100% - 24px); }
  .knob img { width: 16px; height: 16px; display: block; }
  @media (pointer: coarse) {
    .turn-toggle { width: 58px; height: 32px; }
    .turn-toggle.black .knob { left: calc(100% - 28px); }
    .knob { width: 26px; height: 26px; }
    .knob img { width: 18px; height: 18px; }
  }
</style>
