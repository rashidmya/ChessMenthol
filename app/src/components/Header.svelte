<script lang="ts">
  // No props — purely presentational
  import logoUrl from '../assets/logo.png';
</script>

<header>
  <div class="brand">
    <img class="mk" src={logoUrl} alt="" />
    <h1>Chess<i>Menthol</i></h1>
  </div>
  <span class="kicker">Chess&nbsp;Analysis</span>
</header>

<style>
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
    height: 30px;
    width: auto;
    align-self: center;
    display: block;
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
</style>
