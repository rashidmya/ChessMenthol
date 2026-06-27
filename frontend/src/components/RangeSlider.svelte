<script lang="ts">
  export let min = 0; export let max = 5; export let value = 0; export let step = 1;
  export let labels: string[] | null = null;
  export let onInput: (v: number) => void = () => {};
  $: fill = ((value - min) / (max - min)) * 100;
  $: text = labels ? labels[value] : String(value);
  function handle(e: Event) { value = Number((e.target as HTMLInputElement).value); onInput(value); }
</script>
<input class="rng" type="range" {min} {max} {step} {value}
  style="--fill:{fill}%" on:input={handle} />
<span class="v" data-testid="range-value">{text}</span>
<style>
  .v{flex:none; min-width:42px; text-align:center; font-family:var(--mono); font-weight:700;
    font-size:11px; color:var(--ink); font-variant-numeric:tabular-nums;
    background:var(--paper-2); border:1px solid var(--keyline-2); border-radius:5px; padding:2px 6px}
  .rng{flex:1; -webkit-appearance:none; appearance:none; height:5px; border-radius:100px; cursor:pointer;
    background:linear-gradient(to right, var(--green) 0 var(--fill,50%), var(--keyline-2) var(--fill,50%) 100%)}
  .rng::-webkit-slider-thumb{-webkit-appearance:none; appearance:none; width:15px; height:15px; border-radius:50%;
    background:var(--green); border:2px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,.3); cursor:pointer}
  .rng::-moz-range-thumb{width:15px; height:15px; border-radius:50%; background:var(--green); border:2px solid #fff; cursor:pointer}
</style>
