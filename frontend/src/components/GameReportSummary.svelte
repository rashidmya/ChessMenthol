<script lang="ts">
  import Icon from './Icon.svelte';
  import AccuracyDial from './AccuracyDial.svelte';
  import EvalGraph from './EvalGraph.svelte';
  import MoveHistory from './MoveHistory.svelte';
  import type { GameReportDto, MoveEntryDto } from '../lib/types';

  export let report: GameReportDto;
  export let moveList: MoveEntryDto[] = [];
  export let currentPly = 0;
  export let onNavigate: (ply: number) => void = () => {};
  export let onStartReview: () => void = () => {};
  export let onBackToAnalysis: () => void = () => {};
  export let onNew: () => void = () => {};

  // Graph wants a win% per position (base + after each move).
  $: wins = [report.startWin, ...report.plies.map((p) => p.winWhite)];
  $: whiteName = report.whiteName ?? 'White';
  $: blackName = report.blackName ?? 'Black';
</script>

<div class="card" data-testid="report-panel">
  <header class="ghead">
    <span class="medal"><Icon name="Trophy" /></span>
    <span class="gtitle">Game Review</span>
    <button type="button" class="toanalysis" data-testid="report-to-analysis"
      title="Back to analysis" aria-label="Back to analysis" on:click={onBackToAnalysis}><Icon name="Microscope" /></button>
  </header>

  <div class="sec dials">
    <AccuracyDial percent={report.white.accuracy} label={whiteName} side="white" testid="acc-white" />
    <AccuracyDial percent={report.black.accuracy} label={blackName} side="black" testid="acc-black" />
  </div>

  <div class="sec">
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
          <td class="rowh"><span class="dot white"></span>{whiteName}</td>
          <td>{report.white.inaccuracy}</td>
          <td>{report.white.mistake}</td>
          <td>{report.white.blunder}</td>
          <td data-testid="acpl-white">{report.white.acpl}</td>
        </tr>
        <tr>
          <td class="rowh"><span class="dot black"></span>{blackName}</td>
          <td>{report.black.inaccuracy}</td>
          <td>{report.black.mistake}</td>
          <td>{report.black.blunder}</td>
          <td data-testid="acpl-black">{report.black.acpl}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="sec grow">
    <MoveHistory {moveList} {currentPly} {onNavigate} />
  </div>

  <div class="gacts">
    <button type="button" class="new" on:click={onNew}>New</button>
    <button type="button" class="review" data-testid="start-review" on:click={onStartReview}>Start Review</button>
  </div>
</div>

<style>
  .card {
    background: var(--card); border: 1px solid var(--keyline); border-radius: 8px;
    box-shadow: 0 12px 30px -24px rgba(40,30,15,.45);
    display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;
  }
  .ghead { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
    padding: 12px 15px; border-bottom: 1px solid var(--keyline); }
  .medal { color: var(--green); font-size: 18px; justify-self: start; }
  .gtitle { font-family: var(--sans); font-weight: 800; font-size: 15px; color: var(--ink); text-align: center; }
  .toanalysis { justify-self: end; width: 30px; height: 30px; display: grid; place-items: center;
    border: 1px solid var(--keyline-2); border-radius: 7px; background: var(--paper-2);
    color: var(--ink-2); font-size: 15px; cursor: pointer; }
  .toanalysis:hover { border-color: var(--green); color: var(--green); background: #fff; }

  .sec { padding: 16px; }
  .sec + .sec { border-top: 1px solid var(--keyline); }
  .dials { display: flex; align-items: center; justify-content: space-around; }
  .grow { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 6px; }

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

  .gacts { display: flex; gap: 8px; padding: 14px 16px; border-top: 1px solid var(--keyline); }
  .new { flex: 1; padding: 10px 16px; border: 1px solid var(--keyline-2); border-radius: 8px; background: var(--paper-2);
    font-family: var(--sans); font-weight: 600; font-size: 13px; color: var(--ink-2); cursor: pointer; }
  .new:hover { border-color: var(--green); color: var(--green); background: #fff; }
  .review { flex: 2; padding: 10px 16px; border: none; border-radius: 9px; background: var(--green);
    font-family: var(--sans); font-weight: 800; font-size: 14px; color: #fff; cursor: pointer; }
  .review:hover { filter: brightness(1.05); }
</style>
