export interface SearchTime { ms: number | null; label: string; }
export const SEARCH_TIMES: SearchTime[] = [
  { ms: 2000, label: '2s' }, { ms: 5000, label: '5s' }, { ms: 10000, label: '10s' },
  { ms: 20000, label: '20s' }, { ms: 30000, label: '30s' }, { ms: null, label: '∞' },
];
export const DEFAULT_SEARCH_INDEX = 2;   // 10s, matches the mockup
export const searchLabel = (i: number) => SEARCH_TIMES[i].label;
