<script lang="ts">
  export let on = false;
  export let onToggle: () => void = () => {};
  export let label = '';
</script>
<div class="sw" class:on role="switch" aria-checked={on} aria-label={label}
  tabindex="0" on:click={onToggle} on:keydown={(e) => e.key === 'Enter' && onToggle()}>
  <span class="knob"></span>
</div>
<style>
  .sw{position:relative; width:32px; height:17px; border-radius:100px; cursor:pointer;
    background:#d9d2c4; border:1px solid var(--keyline-2); transition:.2s}
  .sw .knob{position:absolute; top:2px; left:2px; width:11px; height:11px; border-radius:50%;
    background:#fff; transition:.2s; box-shadow:0 1px 2px rgba(0,0,0,.28)}
  .sw.on{background:var(--best); border-color:var(--best)}
  .sw.on .knob{left:17px}
</style>
