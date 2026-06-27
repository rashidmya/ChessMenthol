<script lang="ts">
  export let sideToMove: 'white' | 'black' = 'white';
  export let onSetTurn: (white: boolean) => void = () => {};
  export let onFlip: () => void = () => {};
</script>

<div class="board-controls">
  <div class="seg" data-testid="turn-seg">
    <button class:on={sideToMove === 'white'} data-turn="w"
      on:click={() => onSetTurn(true)}><span class="disc"></span>White</button>
    <button class:on={sideToMove === 'black'} data-turn="b"
      on:click={() => onSetTurn(false)}><span class="disc"></span>Black</button>
  </div>
  <button class="icobtn" data-testid="flip-btn" title="Flip board" on:click={onFlip}>
    <!-- verbatim flip SVG from MOCKUP line 264 -->
    <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M6.09 19h12l-1.3 1.29a1 1 0 0 0 1.42 1.42l3-3a1 1 0 0 0 0-1.42l-3-3a1 1 0 0 0-1.42 0a1 1 0 0 0 0 1.42l1.3 1.29h-12a1.56 1.56 0 0 1-1.59-1.53V13a1 1 0 0 0-2 0v2.47A3.56 3.56 0 0 0 6.09 19m-.3-9.29a1 1 0 1 0 1.42-1.42L5.91 7h12a1.56 1.56 0 0 1 1.59 1.53V11a1 1 0 0 0 2 0V8.53A3.56 3.56 0 0 0 17.91 5h-12l1.3-1.29a1 1 0 0 0 0-1.42a1 1 0 0 0-1.42 0l-3 3a1 1 0 0 0 0 1.42Z"></path></svg>
  </button>
</div>

<style>
  /* ported from MOCKUP line 66 + lines 214-225 */
  .board-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 10px;
  }
  .seg {
    display: inline-flex;
    background: var(--paper-2, #faf7f0);
    border: 1px solid var(--keyline, #e0dacb);
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
  }
  .seg button {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: var(--sans, 'Hanken Grotesk', sans-serif);
    font-weight: 600;
    font-size: 12px;
    color: var(--ink-faint, #a8a193);
    background: transparent;
    border: none;
    padding: 6px 12px;
    cursor: pointer;
    border-radius: 6px;
    transition: .18s;
    letter-spacing: .01em;
  }
  .seg button .disc {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid var(--keyline-2, #cfc7b3);
  }
  .seg button[data-turn=w] .disc { background: #fbfaf6; }
  .seg button[data-turn=b] .disc { background: #3a352d; }
  .seg button:hover { color: var(--ink-3, #7d776b); }
  .seg button.on {
    color: var(--ink-2, #46423a);
    background: var(--card, #fdfbf6);
    box-shadow: 0 1px 2px rgba(40,30,15,.08);
  }
  .icobtn {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--ink-3, #7d776b);
    transition: .15s;
  }
  .icobtn:hover { color: var(--green, #2f5d3a); }
  .icobtn svg { width: 19px; height: 19px; }
</style>
