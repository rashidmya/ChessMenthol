<script lang="ts">
  // The shared right-panel shell: a card with a three-column header
  // (left button / centered title / right button), a body slot, and an
  // optional footer area for the screen's controls and extra buttons.
  // Header and footer share a darker "chrome" background; the body sits
  // lighter between them. Every screen's right panel renders through this
  // so the frame, header/footer layout, and rise-in animation stay identical.
  export let title = '';
  export let testid: string | undefined = undefined;
</script>

<div class="card" data-testid={testid}>
  <header class="ghead">
    <div class="hslot left"><slot name="left" /></div>
    <span class="gtitle">{title}</span>
    <div class="hslot right"><slot name="right" /></div>
  </header>
  <slot />
  {#if $$slots.footer}
    <footer class="gfoot" data-testid="panel-footer"><slot name="footer" /></footer>
  {/if}
</div>

<style>
  .card {
    background: var(--card);
    border: 1px solid var(--keyline);
    border-radius: 8px;
    box-shadow: 0 12px 30px -24px rgba(40, 30, 15, 0.45);
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    animation: rise 0.55s ease both;
  }

  .ghead {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 12px 15px;
    background: var(--paper);
    border-bottom: 1px solid var(--keyline);
  }

  /* Footer chrome: shares the header's darker background and sits below the
     body. Padding stays 0 — the slotted controls bring their own spacing. */
  .gfoot {
    background: var(--paper);
    border-top: 1px solid var(--keyline);
  }
  .hslot { display: flex; align-items: center; }
  .hslot.left { justify-self: start; }
  .hslot.right { justify-self: end; }
  .gtitle {
    font-family: var(--sans);
    font-weight: 800;
    font-size: 15px;
    color: var(--ink);
    text-align: center;
  }

  /* Shared styling for slotted header icon-buttons. Slotted content is styled
     by the parent, so panels opt in by putting class="hbtn" on their button;
     the `.ghead :global(.hbtn)` form keeps the reach scoped to this header. */
  .ghead :global(.hbtn) {
    width: 30px; height: 30px; display: grid; place-items: center;
    border: 1px solid var(--keyline-2); border-radius: 7px; background: var(--paper-2);
    color: var(--ink-2); font-size: 15px; cursor: pointer; transition: 0.14s;
  }
  .ghead :global(.hbtn:hover) { border-color: var(--green); color: var(--green); background: #fff; }

  @keyframes rise {
    from { opacity: 0; transform: translateY(9px); }
    to   { opacity: 1; transform: none; }
  }
</style>
