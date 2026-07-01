<script lang="ts">
  import AccuracyDial from './AccuracyDial.svelte';
  import EvalGraph from './EvalGraph.svelte';
  import MoveHistory from './MoveHistory.svelte';
  import type { GameReportDto, MoveEntryDto } from '../lib/types';

  export let report: GameReportDto;
  export let moveList: MoveEntryDto[] = [];
  export let currentPly = 0;
  export let onNavigate: (ply: number) => void = () => {};
  export let onBack: () => void = () => {};
  export let onNew: () => void = () => {};

  // Graph wants a win% per position (base + after each move).
  $: wins = [report.startWin, ...report.plies.map((p) => p.winWhite)];
</script>

<div class="card" data-testid="report-panel">
  <div class="pbar">
    <button type="button" class="back" data-testid="report-back" aria-label="Back to analysis" on:click={onBack}>←</button>
    <span class="ptitle">Game Report</span>
  </div>

  <div class="sec dials">
    <AccuracyDial percent={report.white.accuracy} label="White" side="white" />
    <AccuracyDial percent={report.black.accuracy} label="Black" side="black" />
  </div>

  <div class="sec">
    <p class="glabel">Evaluation · white winning chances</p>
    <EvalGraph {wins} {currentPly} {onNavigate} />
  </div>

  <div class="sec">
    <table class="counts">
      <thead>
        <tr>
          <th class="rowh">&nbsp;</th>
          <th>?!</th>
          <th>?</th>
          <th>??</th>
          <th>ACPL</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="rowh"><span class="dot white"></span>White</td>
          <td>{report.white.inaccuracy}</td>
          <td>{report.white.mistake}</td>
          <td>{report.white.blunder}</td>
          <td>{report.white.acpl}</td>
        </tr>
        <tr>
          <td class="rowh"><span class="dot black"></span>Black</td>
          <td>{report.black.inaccuracy}</td>
          <td>{report.black.mistake}</td>
          <td>{report.black.blunder}</td>
          <td>{report.black.acpl}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="sec grow">
    <MoveHistory {moveList} {currentPly} {onNavigate} />
  </div>

  <div class="sec acts">
    <button type="button" class="new" on:click={onNew}>New analysis</button>
  </div>
</div>

<style>
  .card {
    background: var(--card); border: 1px solid var(--keyline); border-radius: 8px;
    box-shadow: 0 1px 0 #fff inset, 0 12px 30px -24px rgba(40,30,15,.45);
    display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;
  }
  .pbar {
    display: flex; align-items: center; gap: 10px; padding: 11px 15px;
    border-bottom: 1px solid var(--keyline);
  }
  .back {
    width: 28px; height: 28px; display: grid; place-items: center;
    border: 1px solid var(--keyline-2); border-radius: 7px;
    background: var(--paper-2); color: var(--ink-2); font-size: 15px; cursor: pointer;
  }
  .back:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .ptitle {
    font-family: var(--mono); font-size: 10px; letter-spacing: .14em;
    text-transform: uppercase; color: var(--ink-2); font-weight: 700;
  }
  .sec { padding: 16px; }
  .sec + .sec { border-top: 1px solid var(--keyline); }
  .dials { display: flex; align-items: center; justify-content: space-around; }
  .grow {
    flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 6px;
  }
  .glabel {
    font-family: var(--mono); font-size: 9px; letter-spacing: .14em;
    text-transform: uppercase; color: var(--ink-faint); margin: 0 0 7px;
  }
  .counts { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .counts th {
    font-family: var(--mono); font-size: 9px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--ink-faint); font-weight: 700;
    text-align: right; padding: 4px 6px;
  }
  .counts th.rowh { text-align: left; }
  .counts td {
    text-align: right; padding: 5px 6px;
    font-variant-numeric: tabular-nums; color: var(--ink-2);
  }
  .counts td.rowh {
    text-align: left; font-weight: 600; color: var(--ink);
    display: flex; align-items: center; gap: 7px;
  }
  .counts tbody tr + tr td { border-top: 1px solid var(--keyline); }
  .dot {
    width: 9px; height: 9px; border-radius: 50%;
    border: 1px solid var(--keyline-2); display: inline-block;
  }
  .dot.white { background: #f7f3ea; }
  .dot.black { background: #2b2823; }
  .acts { display: flex; justify-content: center; }
  .new {
    padding: 9px 16px; border: 1px solid var(--keyline-2); border-radius: 8px;
    background: var(--paper-2); font-family: var(--sans); font-weight: 600;
    font-size: 13px; color: var(--ink-2); cursor: pointer;
  }
  .new:hover { border-color: var(--green); color: var(--green); background: #fff; }
</style>
