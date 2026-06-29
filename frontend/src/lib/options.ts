export interface SearchTime { ms: number | null; label: string; }
export const SEARCH_TIMES: SearchTime[] = [
  { ms: 2000, label: '2s' }, { ms: 5000, label: '5s' }, { ms: 10000, label: '10s' },
  { ms: 20000, label: '20s' }, { ms: 30000, label: '30s' }, { ms: null, label: '∞' },
];
export const MEMORY_MB = [16, 32, 64, 128, 256, 512];
export const DEFAULT_SEARCH_INDEX = 2;   // 10s, matches the mockup
export const DEFAULT_MEMORY_INDEX = 4;   // 256MB
export const DEFAULT_LINES = 3;          // multipv (slider min is 1; multipv must be >= 1)
export const DEFAULT_THREADS = 4;
export const searchLabel = (i: number) => SEARCH_TIMES[i].label;
export const memoryLabel = (i: number) => `${MEMORY_MB[i]}MB`;

export interface EngineOption { id: string; label: string; }
export const ENGINES: EngineOption[] = [
  { id: 'stockfish', label: 'Stockfish' },
  { id: 'stockfish_lite', label: 'Stockfish Lite' },
];
export const engineLabel = (id: string) => ENGINES.find((e) => e.id === id)?.label ?? id;
