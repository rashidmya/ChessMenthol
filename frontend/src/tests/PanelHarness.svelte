<script lang="ts">
  // Test fixture: exercises Panel's named slots + default (body) slot.
  import Panel from '../components/Panel.svelte';
</script>

<Panel title="Game Review" testid="my-panel">
  <button slot="left" class="hbtn" data-testid="hl">L</button>
  <button slot="right" class="hbtn" data-testid="hr">R</button>
  <div data-testid="body">body content</div>
  <div slot="footer" data-testid="ctrl">controls here</div>
</Panel>
