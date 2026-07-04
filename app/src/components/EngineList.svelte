<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { list, add, remove, type EngineRecord } from '../lib/engineRegistry';
  import { setSchema, clear as clearOptions } from '../lib/engineOptions';
  import { parseOptions } from '../engine/uciOptions';
  import { isMobile } from '../lib/platform';

  export let engineId: string = 'stockfish';
  export let onSetEngine: (id: string) => void = () => {};

  // How long an add error stays visible before auto-dismissing.
  const ADD_ERROR_TIMEOUT_MS = 3000;

  // Local snapshot of the registry; refreshed after add/remove.
  let engines: EngineRecord[] = list();
  let validating = false;
  let addError: string | null = null;
  let addErrorTimer: ReturnType<typeof setTimeout> | null = null;
  // "+ Add engine" and external engines are desktop-Tauri-only (native file picker +
  // arbitrary-binary spawn) — neither maps to a phone, so hide it on mobile.
  const canAdd = isTauri() && !isMobile();

  function refresh(): void { engines = list(); }

  // Show (or clear) the add error, auto-dismissing it after ADD_ERROR_TIMEOUT_MS so a
  // stale failure message doesn't linger. Any pending dismiss is reset first.
  function setAddError(msg: string | null): void {
    if (addErrorTimer !== null) { clearTimeout(addErrorTimer); addErrorTimer = null; }
    addError = msg;
    if (msg !== null) {
      addErrorTimer = setTimeout(() => { addError = null; addErrorTimer = null; }, ADD_ERROR_TIMEOUT_MS);
    }
  }

  onDestroy(() => { if (addErrorTimer !== null) clearTimeout(addErrorTimer); });

  function select(id: string): void {
    if (id !== engineId) onSetEngine(id);
  }

  function removeEngine(id: string): void {
    remove(id);
    clearOptions(id);
    refresh();
    if (id === engineId) onSetEngine('stockfish'); // fall back to bundled
  }

  async function addEngine(): Promise<void> {
    setAddError(null);
    let path: string | null;
    try {
      const picked = await open({ multiple: false, directory: false, title: 'Choose a UCI engine' });
      path = typeof picked === 'string' ? picked : null;
    } catch (e) {
      setAddError(`couldn't open the file picker: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!path) return; // user cancelled
    validating = true;
    try {
      const { name, option_lines } = await invoke<{ name: string; option_lines: string[] }>(
        'engine_probe', { spec: { kind: 'external', path } },
      );
      const record: EngineRecord = { id: crypto.randomUUID(), name, kind: 'external', path };
      add(record);
      setSchema(record.id, parseOptions(option_lines));
      refresh();
      onSetEngine(record.id);
    } catch (e) {
      setAddError(`${path} isn't a working UCI engine (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      validating = false;
    }
  }
</script>

<div class="elist" role="radiogroup" aria-label="Engine">
  {#each engines as eng (eng.id)}
    <div class="erow" class:sel={eng.id === engineId}>
      <button
        type="button"
        role="radio"
        aria-checked={eng.id === engineId}
        class="pick"
        on:click={() => select(eng.id)}
      >
        <span class="dot"><Icon name={eng.id === engineId ? 'Disc' : 'DiscOutline'} /></span>
        <span class="name">{eng.name}</span>
        {#if eng.kind === 'external'}<span class="path">{eng.path}</span>{/if}
      </button>
      {#if eng.kind === 'external'}
        <button type="button" class="rm" aria-label={`Remove ${eng.name}`} on:click={() => removeEngine(eng.id)}>
          <Icon name="X" />
        </button>
      {/if}
    </div>
  {/each}

  {#if validating}
    <div class="erow validating"><span class="dot">{'…'}</span><span class="name">validating…</span></div>
  {/if}

  {#if canAdd}
    <button type="button" class="addbtn" on:click={addEngine} disabled={validating}>+ Add engine</button>
  {/if}

  {#if addError}<div class="adderr" role="alert">{addError}</div>{/if}
</div>

<style>
  .elist { display: flex; flex-direction: column; gap: 4px; }
  .erow { display: flex; align-items: center; gap: 6px; }
  .pick { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0;
    font-family: var(--sans); font-size: 12px; color: var(--ink);
    background: var(--btn); border: 1px solid var(--keyline-2); border-radius: 6px;
    padding: 7px 10px; cursor: pointer; text-align: left; transition: .14s; }
  .pick:hover { border-color: var(--green); }
  .erow.sel .pick { border-color: var(--green); background: #fff; }
  .pick .dot { flex: none; color: var(--green); font-size: 11px; line-height: 1; }
  .pick .name { font-weight: 600; white-space: nowrap; }
  .pick .path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--mono); font-size: 9.5px; color: var(--ink-3); }
  .rm { flex: none; width: 22px; height: 22px; display: grid; place-items: center;
    border: 1px solid var(--keyline-2); background: var(--btn); border-radius: 6px;
    cursor: pointer; color: var(--ink-3); font-size: 11px; line-height: 1; transition: .14s; }
  .rm:hover { border-color: #c0392b; color: #c0392b; background: #fff; }
  .validating { padding: 7px 10px; font-family: var(--sans); font-size: 12px; color: var(--ink-3); }
  .validating .dot { margin-right: 8px; }
  .addbtn { font-family: var(--mono); font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase;
    color: var(--ink-2); font-weight: 700; background: transparent; border: 1px dashed var(--keyline-2);
    border-radius: 6px; padding: 7px 10px; cursor: pointer; transition: .14s; }
  .addbtn:hover:not(:disabled) { border-color: var(--green); color: var(--green); }
  .addbtn:disabled { opacity: .5; cursor: default; }
  .adderr { font-family: var(--sans); font-size: 11px; color: #c0392b; line-height: 1.3; }
</style>
