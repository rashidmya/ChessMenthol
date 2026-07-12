<script lang="ts">
  import wPawn from '../assets/pieces/cburnett/wP.svg';
  import bPawn from '../assets/pieces/cburnett/bP.svg';
  export let sideToMove: 'white' | 'black' = 'white';
  export let onSetTurn: (white: boolean) => void = () => {};
  $: black = sideToMove === 'black';
  // Toggling flips the side to move. With only two states, "currently black"
  // is exactly the desired new `white` flag (black→white=true, white→black=false),
  // so the click handler passes `black` directly to onSetTurn(white).
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
    width: 44px;
    height: 22px;
    border-radius: 11px;
    /* White to move -> the track itself reads white; black to move darkens it. */
    background: #ffffff;
    border: 1px solid var(--keyline-2, #cfc7b3);
    box-shadow: inset 0 1px 2px rgba(40, 30, 15, 0.12);
    cursor: pointer;
    padding: 0;
    flex: none;
    transition: background 0.2s, border-color 0.2s;
  }
  .turn-toggle.black {
    background: #26221c;
    border-color: #120f0a;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.55);
  }
  .knob {
    position: absolute;
    top: 50%;
    left: 2px;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fbf9f4;
    /* Ring is a touch stronger so the near-white knob stays legible on the white track. */
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(0, 0, 0, 0.12);
    display: grid;
    place-items: center;
    transition: left 0.2s;
  }
  .turn-toggle.black .knob { left: calc(100% - 20px); }
  .knob img { width: 13px; height: 13px; display: block; }
  @media (pointer: coarse) {
    .turn-toggle { width: 50px; height: 26px; border-radius: 13px; }
    .turn-toggle.black .knob { left: calc(100% - 24px); }
    .knob { width: 22px; height: 22px; }
    .knob img { width: 15px; height: 15px; }
  }
</style>
