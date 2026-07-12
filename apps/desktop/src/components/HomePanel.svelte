<script lang="ts">
  import Icon from './Icon.svelte';
  import Panel from './Panel.svelte';
  export let hasCapture = false;
  export let onSetUp: () => void = () => {};
  export let onExplore: () => void = () => {};
  export let onCapture: () => void = () => {};
  export let onStart: (text: string) => void = () => {};
  let input = '';
</script>

<Panel title="Start" testid="home-panel">
  <div class="body">
    <button type="button" class="hbtn" on:click={onSetUp}><span class="ic"><Icon name="Pencil" /></span>Set Up Position</button>
    <button type="button" class="hbtn" on:click={onExplore}><span class="ic"><Icon name="StudyBoard" /></span>Explore</button>
    {#if hasCapture}
      <button type="button" class="hbtn cap" on:click={onCapture}><span class="ic"><Icon name="ScreenDesktop" /></span>Capture Board</button>
    {/if}
    <textarea class="area" bind:value={input}
      placeholder="Paste your FEN, PGN(s), or drag & drop a PGN file here."></textarea>
  </div>
  <div class="foot" slot="footer">
    <button type="button" class="primary" on:click={() => onStart(input)}>Start Analysis</button>
  </div>
</Panel>

<style>
  .body { padding: 18px 16px 6px; display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .foot { padding: 14px 16px; }
  .hbtn {
    width: 100%; display: flex; align-items: center; justify-content: center; gap: 13px;
    padding: 19px 16px; margin-bottom: 12px; font-family: var(--sans); font-weight: 600;
    font-size: 15.5px; color: var(--ink-2); background: var(--btn);
    border: 1px solid var(--keyline-2); border-radius: 10px; cursor: pointer; transition: .14s;
  }
  .hbtn:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .hbtn .ic { font-size: 19px; }
  .hbtn.cap { border-style: dashed; }
  .area {
    width: 100%; flex: 1; min-height: 120px; resize: none; margin: 6px 0 14px; padding: 14px;
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
