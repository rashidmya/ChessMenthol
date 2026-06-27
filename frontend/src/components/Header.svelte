<script lang="ts">
  // No props — purely presentational
</script>

<header>
  <div class="brand">
    <span class="mk">&#9822;</span>
    <h1>Chess<i>Menthol</i></h1>
  </div>
  <span class="kicker">Chess&nbsp;Analysis</span>
</header>

<style>
  /* ported from MOCKUP lines 36-44 */
  header {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    margin-bottom: 22px;
    border-bottom: 2px solid var(--ink, #1b1916);
    padding-bottom: 14px;
    animation: rise .5s ease both;
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 11px;
  }
  .brand .mk {
    font-size: 27px;
    color: var(--green, #2f5d3a);
    transform: translateY(3px);
    font-family: var(--sym, 'Segoe UI Symbol', 'Apple Symbols', sans-serif);
  }
  .brand h1 {
    font-family: var(--serif, 'Fraunces', Georgia, serif);
    font-weight: 600;
    font-size: 29px;
    letter-spacing: -.018em;
    margin: 0;
    line-height: 1;
  }
  .brand h1 i {
    font-style: italic;
    font-weight: 500;
    color: var(--green, #2f5d3a);
  }
  .kicker {
    font-family: var(--mono, 'Space Mono', monospace);
    font-size: 10px;
    letter-spacing: .22em;
    text-transform: uppercase;
    color: var(--ink-3, #7d776b);
    padding-bottom: 4px;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(9px); }
    to   { opacity: 1; transform: none; }
  }
</style>
