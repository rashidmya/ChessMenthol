export interface EvalDto { cp: number | null; mate: number | null; text: string; }
export interface LineDto {
  multipv: number; scoreText: string; cp: number | null; mate: number | null;
  pv: string[]; san: string;
}
export interface ClassificationDto { label: string; cpl: number; isBest: boolean; }
export interface MoveEntryDto {
  ply: number; san: string; uci: string; classification: ClassificationDto | null;
}

// ── report DTOs ──────────────────────────────────────────────────────────────
export interface PlyReportDto {
  ply: number;            // 1..N
  san: string; uci: string;
  winWhite: number;       // 0..100, White POV (for the graph)
  cpl: number;            // mover POV, capped
  classification: ClassificationDto | null;
}
export interface PlayerReportDto { accuracy: number; acpl: number; inaccuracy: number; mistake: number; blunder: number; }
export interface GameReportDto {
  white: PlayerReportDto; black: PlayerReportDto;
  startWin: number;       // White-POV win% at the base position (graph point 0)
  plies: PlyReportDto[];
}
export interface ReportFrame { type: 'report'; report: GameReportDto }
export interface LastMovePvDto { san: string; uci?: string; evalText: string; pv: string; }
export interface LastMoveDto {
  classification: ClassificationDto;
  played: LastMovePvDto;
  best: LastMovePvDto & { uci: string };
}
export interface StateFrame {
  type: 'state'; fen: string; sideToMove: 'white' | 'black'; engineId: string;
  analyzing: boolean; eval: EvalDto | null; depth: number; lines: LineDto[];
  lastMove: LastMoveDto | null;
  visionStatus: 'idle' | 'found' | 'no_board' | 'low_confidence';
  detectedOrientation: 'white' | 'black' | null; lowConfidence: string[];
  region: { left: number; top: number; width: number; height: number } | null;
  moveList: MoveEntryDto[];
  currentPly: number;
  analysisEnabled: boolean;
  movetime: number | null;
  reportProgress: { done: number; total: number } | null;
  gameOver: { result: string; reason: string } | null;
}
export interface RegionShotFrame { type: 'region_shot'; jpegBase64: string; width: number; height: number; }
export interface ErrorFrame { type: 'error'; message: string; }
export type ServerFrame = StateFrame | ErrorFrame | RegionShotFrame | ReportFrame;

export type Command =
  | { type: 'set_fen'; fen: string }
  | { type: 'set_turn'; white: boolean }
  | { type: 'make_move'; uci: string }
  | { type: 'undo' }
  | { type: 'set_engine'; id: string }
  | { type: 'set_options'; depth?: number; movetime?: number | null }
  | { type: 'set_engine_option'; name: string; value?: string }
  | { type: 'reset_engine_option'; name: string }
  | { type: 'reset_engine_options' }
  | { type: 'stop' }
  | { type: 'capture_now' }
  | { type: 'request_region_shot' }
  | { type: 'set_region'; left: number; top: number; width: number; height: number }
  | { type: 'clear_region' }
  | { type: 'play_best'; uci: string }
  | { type: 'navigate'; index: number }
  | { type: 'reset' }
  | { type: 'set_analysis_enabled'; enabled: boolean }
  | { type: 'load_pgn'; pgn: string }
  | { type: 'analyze_game' }
  | { type: 'cancel_analysis' };
