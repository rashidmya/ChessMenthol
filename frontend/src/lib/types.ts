export interface EvalDto { cp: number | null; mate: number | null; text: string; }
export interface LineDto {
  multipv: number; scoreText: string; cp: number | null; mate: number | null;
  pv: string[]; san: string;
}
export interface ClassificationDto { label: string; cpl: number; isBest: boolean; }
export interface LastMovePvDto { san: string; evalText: string; pv: string; }
export interface LastMoveDto {
  classification: ClassificationDto;
  played: LastMovePvDto;
  best: LastMovePvDto & { uci: string };
}
export interface StateFrame {
  type: 'state'; fen: string; sideToMove: 'white' | 'black'; engineId: string;
  analyzing: boolean; eval: EvalDto | null; depth: number; lines: LineDto[];
  lastMove: LastMoveDto | null;
  tracking: boolean; visionStatus: 'off' | 'searching' | 'tracking' | 'low_confidence';
  detectedOrientation: 'white' | 'black' | null; lowConfidence: string[];
}
export interface ErrorFrame { type: 'error'; message: string; }
export type ServerFrame = StateFrame | ErrorFrame;

export type Command =
  | { type: 'set_fen'; fen: string }
  | { type: 'set_turn'; white: boolean }
  | { type: 'make_move'; uci: string }
  | { type: 'undo' }
  | { type: 'set_engine'; id: string }
  | { type: 'set_options'; depth?: number; multipv?: number; threads?: number; hash?: number }
  | { type: 'stop' }
  | { type: 'set_auto'; on: boolean }
  | { type: 'capture_now' };
