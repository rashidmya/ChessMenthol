<script lang="ts">
  import Icon from './Icon.svelte';
  import EditPalette from './EditPalette.svelte';
  import type { CastlingRights } from '../lib/edit';

  export let fen = '';
  export let side: 'white' | 'black' = 'white';
  export let castle: CastlingRights = { K: true, Q: true, k: true, q: true };
  export let selected: string | null = 'P';
  export let pgn = '';
  export let editError: string | null = null;
  export let onSelect: (tok: string) => void = () => {};
  export let onSide: (white: boolean) => void = () => {};
  export let onToggleCastle: (key: keyof CastlingRights) => void = () => {};
  export let onFlip: () => void = () => {};
  export let onReset: () => void = () => {};
  export let onClear: () => void = () => {};
  export let onFenInput: (text: string) => void = () => {};
  export let onLoad: () => void = () => {};
  export let onBack: () => void = () => {};
</script>

<div class="edit" data-testid="edit-panel">
  <div class="pbar">
    <button type="button" class="back" data-testid="edit-back" aria-label="Back" on:click={onBack}><Icon name="Back" /></button>
    <span class="ptitle">Set Up Position</span>
  </div>
  <div class="body">
    <EditPalette {selected} {onSelect} />

    <div class="row">
      <select class="sel" data-testid="side-select" value={side}
        on:change={(e) => onSide((e.currentTarget as HTMLSelectElement).value === 'white')}>
        <option value="white">White to move</option>
        <option value="black">Black to move</option>
      </select>
      <button type="button" class="ico" data-testid="edit-flip" title="Flip board" on:click={onFlip}><Icon name="ChasingArrows" /></button>
      <button type="button" class="ico" data-testid="edit-reset" title="Start position" on:click={onReset}><Icon name="Reload" /></button>
      <button type="button" class="ico" data-testid="edit-clear" title="Clear board" on:click={onClear}><Icon name="Trash" /></button>
    </div>

    <div class="castle">
      <div class="col">
        <div class="lab">White</div>
        <label class="ck"><input type="checkbox" data-testid="castle-K" checked={castle.K} on:change={() => onToggleCastle('K')} /> O-O</label>
        <label class="ck"><input type="checkbox" data-testid="castle-Q" checked={castle.Q} on:change={() => onToggleCastle('Q')} /> O-O-O</label>
      </div>
      <div class="col">
        <div class="lab">Black</div>
        <label class="ck"><input type="checkbox" data-testid="castle-k" checked={castle.k} on:change={() => onToggleCastle('k')} /> O-O</label>
        <label class="ck"><input type="checkbox" data-testid="castle-q" checked={castle.q} on:change={() => onToggleCastle('q')} /> O-O-O</label>
      </div>
    </div>

    <input class="fen" data-testid="edit-fen" value={fen} spellcheck="false"
      on:input={(e) => onFenInput((e.currentTarget as HTMLInputElement).value)} />

    <textarea class="pgn" data-testid="edit-pgn" readonly value={pgn}
      placeholder={'[Event "?"]\n[Site "?"]\n[Date "????.??.??"]\n[Round "?"]\n[White "?"]\n[Black "?"]\n[Result "*"]'}></textarea>

    {#if editError}<div class="err" role="alert" data-testid="edit-error">{editError}</div>{/if}
    <button type="button" class="primary" on:click={onLoad}>Load</button>
  </div>
</div>

<style>
  .edit {
    background: var(--card); border: 1px solid var(--keyline); border-radius: 8px;
    box-shadow: 0 12px 30px -24px rgba(40,30,15,.45);
    display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;
  }
  .pbar { display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-bottom: 1px solid var(--keyline); }
  .back { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--keyline-2);
    border-radius: 8px; background: var(--paper-2); color: var(--ink-2); font-size: 16px; cursor: pointer; transition: .14s; }
  .back:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .ptitle { font-family: var(--mono); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-2); font-weight: 700; }
  .body { padding: 16px; display: flex; flex-direction: column; overflow-y: auto; }
  .row { display: flex; align-items: center; gap: 9px; margin: 14px 0; }
  .sel { flex: 1; padding: 11px 13px; border: 1px solid var(--keyline-2); border-radius: 9px; background: #fff;
    color: var(--ink-2); font-family: var(--sans); font-weight: 600; font-size: 13px; }
  .ico { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--keyline);
    border-radius: 8px; background: var(--paper-2); color: var(--ink-3); font-size: 16px; cursor: pointer; transition: .14s; }
  .ico:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .castle { display: flex; gap: 20px; margin-bottom: 14px; }
  .castle .col { flex: 1; }
  .castle .lab { font-family: var(--mono); font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); margin-bottom: 7px; }
  .ck { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); margin-bottom: 7px; cursor: pointer; }
  .fen { width: 100%; padding: 12px 14px; border: 1px solid var(--keyline-2); border-radius: 9px; background: #fff;
    color: var(--ink-2); font-family: var(--mono); font-size: 11.5px; margin-bottom: 12px; }
  .fen:focus { outline: none; border-color: var(--green); box-shadow: 0 0 0 3px rgba(47,93,58,.12); }
  .pgn { width: 100%; height: 110px; padding: 13px 14px; border: 1px solid var(--keyline-2); border-radius: 9px;
    background: #fff; color: var(--ink-3); font-family: var(--mono); font-size: 11.5px; resize: vertical; margin-bottom: 12px; }
  .err { color: var(--blun); font-size: 12px; margin-bottom: 10px; }
  .primary { width: 100%; padding: 16px; border: none; border-radius: 10px; background: var(--green); color: #fff;
    font-family: var(--sans); font-weight: 700; font-size: 15px; cursor: pointer; transition: .14s; }
  .primary:hover { background: var(--green-soft); }
</style>
