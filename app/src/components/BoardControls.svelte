<script lang="ts">
  import Icon from './Icon.svelte';
  import TurnToggle from './TurnToggle.svelte';
  export let sideToMove: 'white' | 'black' = 'white';
  export let onSetTurn: (white: boolean) => void = () => {};
  export let onFlip: () => void = () => {};
  // Board (capture) orientation is chosen at capture time in RegionOverlay, not here.
</script>

<div class="board-controls">
  <TurnToggle {sideToMove} {onSetTurn} />
  <button class="icobtn" data-testid="flip-btn" title="Flip board" on:click={onFlip}>
    <Icon name="ChasingArrows" />
  </button>
</div>

<style>
  .board-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 4px;
  }
  .icobtn {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--ink-3, #7d776b);
    font-size: 18px;
    line-height: 1;
    transition: .15s;
  }
  .icobtn:hover { color: var(--green, #2f5d3a); }
</style>
