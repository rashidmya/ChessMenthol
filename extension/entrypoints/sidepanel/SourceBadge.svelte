<script lang="ts">
  export let source: 'manual' | 'vision' | 'chesscom' | 'lichess' = 'manual';
  export let sideToMove: 'white' | 'black' = 'white';
  const LABEL = { manual: 'manual', vision: 'vision', chesscom: 'chess.com', lichess: 'lichess' };
</script>

<span class="badge {source}" data-testid="source">
  <span class="src">{LABEL[source]}</span>
  <span class="dot">·</span>
  <span class="turn">{sideToMove === 'white' ? 'White' : 'Black'} to move</span>
</span>

<style>
  .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px;
    padding: 2px 8px; border-radius: 20px; background: #2f4a63; color: #cfe4f5; }
  .badge.vision { background: #4a3f63; color: #e0d4f5; }
  .badge.manual { background: #3a3a3a; color: #ddd; }
  .src { font-weight: 600; text-transform: capitalize; }
  .dot { opacity: .6; }
  .turn { opacity: .85; }
</style>
