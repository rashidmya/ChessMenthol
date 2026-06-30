<script lang="ts">
  import Icon from './Icon.svelte';
  export let hasCapture = false;
  export let onSetUp: () => void = () => {};
  export let onExplore: () => void = () => {};
  export let onCapture: () => void = () => {};
  export let onStart: (text: string) => void = () => {};
  let input = '';
</script>

<div class="home" data-testid="home-panel">
  <div class="pbar"><span class="ptitle">Start</span></div>
  <div class="body">
    <button type="button" class="hbtn" on:click={onSetUp}><span class="ic"><Icon name="Pencil" /></span>Set Up Position</button>
    <button type="button" class="hbtn" on:click={onExplore}><span class="ic"><Icon name="Microscope" /></span>Explore</button>
    {#if hasCapture}
      <button type="button" class="hbtn cap" on:click={onCapture}><span class="ic"><Icon name="ScreenDesktop" /></span>Capture Board</button>
    {/if}
    <textarea class="area" bind:value={input}
      placeholder="Paste your FEN, PGN(s), or drag & drop a PGN file here."></textarea>
    <button type="button" class="primary" on:click={() => onStart(input)}>Start Analysis</button>
  </div>
</div>

<style>
  .home {
    background: var(--card); border: 1px solid var(--keyline); border-radius: 8px;
    box-shadow: 0 1px 0 #fff inset, 0 12px 30px -24px rgba(40,30,15,.45);
    display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;
  }
  .pbar { padding: 11px 16px; border-bottom: 1px solid var(--keyline); }
  .ptitle { font-family: var(--mono); font-size: 10px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--ink-2); font-weight: 700; }
  .body { padding: 18px 16px; display: flex; flex-direction: column; }
  .hbtn {
    width: 100%; display: flex; align-items: center; justify-content: center; gap: 13px;
    padding: 19px 16px; margin-bottom: 12px; font-family: var(--sans); font-weight: 600;
    font-size: 15.5px; color: var(--ink-2); background: var(--paper-2);
    border: 1px solid var(--keyline-2); border-radius: 10px; cursor: pointer; transition: .14s;
  }
  .hbtn:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .hbtn .ic { font-size: 19px; }
  .hbtn.cap { border-style: dashed; }
  .area {
    width: 100%; min-height: 150px; resize: vertical; margin: 6px 0 14px; padding: 14px;
    border: 1px solid var(--keyline-2); border-radius: 10px; background: #fff;
    color: var(--ink-2); font-family: var(--mono); font-size: 12px;
  }
  .area::placeholder { color: var(--ink-faint); }
  .area:focus { outline: none; border-color: var(--green); box-shadow: 0 0 0 3px rgba(47,93,58,.12); }
  .primary {
    width: 100%; padding: 18px; border: none; border-radius: 10px; background: var(--green);
    color: #fff; font-family: var(--sans); font-weight: 700; font-size: 16px; cursor: pointer; transition: .14s;
  }
  .primary:hover { background: var(--green-soft); }
</style>
