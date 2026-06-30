<script lang="ts">
  import type { Command } from '../lib/types';
  import type { UciOption } from '../engine/uciOptions';
  import { ensureSchema, getSchema, effectiveValues, setOption, resetOption, resetAll } from '../lib/engineOptions';

  export let engineId: string = 'stockfish';
  export let onCommand: (cmd: Command) => void = () => {};

  // Synchronous init from cache so components using getByText don't see a loading
  // flash when the schema is already stored.
  const _init = getSchema(engineId);
  let schema: UciOption[] = _init ?? [];
  let values: Record<string, string> = _init ? effectiveValues(engineId) : {};
  let loading = !_init;
  let failed = false;

  async function load(id: string): Promise<void> {
    // Don't flash a loading state if the schema is already cached.
    const cached = getSchema(id);
    if (!cached) { loading = true; failed = false; }
    const result = await ensureSchema(id);
    if (id !== lastId) return;          // engine changed mid-probe → discard stale result
    schema = result;
    values = effectiveValues(id);
    failed = result.length === 0;
    loading = false;
  }
  // Load on mount and whenever the selected engine changes (guarded against re-runs
  // from unrelated reactive updates).
  let lastId = '';
  $: void reloadFor(engineId);
  async function reloadFor(id: string): Promise<void> { if (id !== lastId) { lastId = id; await load(id); } }

  function clampSpin(o: UciOption, raw: string): string {
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return o.default ?? '0';
    if (o.min != null) n = Math.max(o.min, n);
    if (o.max != null) n = Math.min(o.max, n);
    return String(n);
  }

  function change(o: UciOption, value: string): void {
    setOption(engineId, o.name, value);
    values = { ...values, [o.name]: value };
    onCommand({ type: 'set_engine_option', name: o.name, value });
  }
  function press(o: UciOption): void { onCommand({ type: 'set_engine_option', name: o.name }); }
  function reset(o: UciOption): void {
    resetOption(engineId, o.name);
    values = effectiveValues(engineId);
    onCommand({ type: 'reset_engine_option', name: o.name });
  }
  function resetEverything(): void {
    resetAll(engineId);
    values = effectiveValues(engineId);
    onCommand({ type: 'reset_engine_options' });
  }
</script>

<div class="opts">
  {#if loading}
    <div class="msg">loading options…</div>
  {:else if failed}
    <div class="msg" role="status">options unavailable for this engine</div>
  {:else}
    {#each schema as o (o.name)}
      <div class="orow">
        {#if o.type !== 'button'}
          <label class="k" for={`opt-${o.name}`}>{o.name}</label>
        {/if}
        {#if o.type === 'spin'}
          <input id={`opt-${o.name}`} type="number" min={o.min} max={o.max}
            value={values[o.name] ?? o.default ?? ''}
            on:change={(e) => change(o, clampSpin(o, (e.currentTarget as HTMLInputElement).value))} />
        {:else if o.type === 'check'}
          <input id={`opt-${o.name}`} type="checkbox" aria-label={o.name}
            checked={(values[o.name] ?? o.default) === 'true'}
            on:change={(e) => change(o, (e.currentTarget as HTMLInputElement).checked ? 'true' : 'false')} />
        {:else if o.type === 'combo'}
          <select id={`opt-${o.name}`} aria-label={o.name}
            value={values[o.name] ?? o.default ?? ''}
            on:change={(e) => change(o, (e.currentTarget as HTMLSelectElement).value)}>
            {#each o.vars ?? [] as v (v)}<option value={v}>{v}</option>{/each}
          </select>
        {:else if o.type === 'string'}
          <input id={`opt-${o.name}`} type="text" value={values[o.name] ?? o.default ?? ''}
            on:change={(e) => change(o, (e.currentTarget as HTMLInputElement).value)} />
        {:else if o.type === 'button'}
          <button type="button" class="btn" on:click={() => press(o)}>{o.name}</button>
        {/if}
        {#if o.type !== 'button'}
          <button type="button" class="rst" aria-label={`Reset ${o.name}`} on:click={() => reset(o)}>↺</button>
        {/if}
      </div>
    {/each}
    <button type="button" class="resetall" on:click={resetEverything}>Reset to defaults</button>
  {/if}
</div>

<style>
  .opts { display: flex; flex-direction: column; gap: 6px; }
  .orow { display: flex; align-items: center; gap: 8px; }
  .orow .k { flex: 1; min-width: 0; font-family: var(--mono); font-size: 9.5px;
    letter-spacing: .04em; text-transform: uppercase; color: var(--ink-3);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .orow input[type="number"], .orow input[type="text"], .orow select {
    width: 90px; font-family: var(--sans); font-size: 12px; color: var(--ink);
    background: var(--paper-2); border: 1px solid var(--keyline-2); border-radius: 6px; padding: 4px 6px; }
  .orow .btn { font-family: var(--mono); font-size: 9.5px; text-transform: uppercase;
    border: 1px solid var(--keyline-2); background: var(--paper-2); border-radius: 6px; padding: 4px 8px; cursor: pointer; }
  .orow .rst { flex: none; width: 22px; height: 22px; display: grid; place-items: center;
    border: 1px solid var(--keyline-2); background: var(--paper-2); border-radius: 6px; cursor: pointer; color: var(--ink-3); }
  .resetall { align-self: flex-start; font-family: var(--mono); font-size: 9.5px; text-transform: uppercase;
    color: var(--ink-2); background: transparent; border: 1px dashed var(--keyline-2); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
  .msg { font-family: var(--sans); font-size: 12px; color: var(--ink-3); padding: 4px 0; }
</style>
