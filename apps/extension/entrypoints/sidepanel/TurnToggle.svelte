<script lang="ts">
  export let sideToMove: 'white' | 'black' = 'white';
  export let onSetTurn: (white: boolean) => void = () => {};
  $: black = sideToMove === 'black';
  // Two states only: "currently black" is exactly the desired new `white` flag
  // (black -> white=true, white -> black=false), so pass `black` straight through.
</script>

<button
  type="button"
  class="turn-toggle"
  class:black
  data-testid="turn-toggle"
  role="switch"
  aria-checked={black}
  aria-label={black ? 'Black to move' : 'White to move'}
  title="Whose move — click to toggle"
  on:click={() => onSetTurn(black)}
>
  <span class="knob"></span>
</button>

<style>
  .turn-toggle {
    position: relative;
    width: 40px;
    height: 20px;
    border-radius: 10px;
    background: #f2f0ea;
    border: 1px solid rgba(0, 0, 0, 0.3);
    box-shadow: inset 0 1px 2px rgba(40, 30, 15, 0.15);
    cursor: pointer;
    padding: 0;
    flex: none;
    transition: background 0.2s, border-color 0.2s;
  }
  .turn-toggle.black {
    background: #26221c;
    border-color: #000;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.55);
  }
  .knob {
    position: absolute;
    top: 50%;
    left: 2px;
    transform: translateY(-50%);
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.15);
    transition: left 0.2s, background 0.2s;
  }
  .turn-toggle.black .knob { left: calc(100% - 18px); background: #d8d2c6; }
</style>
