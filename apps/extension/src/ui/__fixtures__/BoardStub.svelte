<script lang="ts">
  // Test stand-in for components/Board.svelte: chessground can't init under jsdom, so a
  // drag can't be simulated. Same props; the buttons fire `onMove(uci)` directly. Every
  // prop is echoed as a data-* attribute so tests can assert on it (and so svelte-check
  // sees them all used).
  export let fen = '';
  export let orientation: 'white' | 'black' = 'white';
  export let onMove: (uci: string) => void = () => {};
  export let revertSignal = 0;
  export let lastMove: string | null = null;
  export let lines: unknown[] = [];
  export let showArrows = true;
</script>

<div data-testid="board" data-fen={fen} data-orientation={orientation} data-revert={revertSignal} data-lastmove={lastMove ?? ''} data-lines={lines.length} data-arrows={showArrows}>
  <button data-testid="stub-move-e2e4" on:click={() => onMove('e2e4')}>e2e4</button>
  <button data-testid="stub-move-illegal" on:click={() => onMove('e2e5')}>e2e5</button>
</div>
