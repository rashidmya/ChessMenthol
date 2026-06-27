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
  visionStatus: 'idle' | 'found' | 'no_board' | 'low_confidence';
  detectedOrientation: 'white' | 'black' | null; lowConfidence: string[];
  region: { left: number; top: number; width: number; height: number } | null;
}
export interface RegionShotFrame { type: 'region_shot'; jpegBase64: string; width: number; height: number; }
export interface ErrorFrame { type: 'error'; message: string; }
export type ServerFrame = StateFrame | ErrorFrame | RegionShotFrame;

export type Command =
  | { type: 'set_fen'; fen: string }
  | { type: 'set_turn'; white: boolean }
  | { type: 'make_move'; uci: string }
  | { type: 'undo' }
  | { type: 'set_engine'; id: string }
  | { type: 'set_options'; depth?: number; multipv?: number; threads?: number; hash?: number }
  | { type: 'stop' }
  | { type: 'capture_now' }
  | { type: 'request_region_shot' }
  | { type: 'set_region'; left: number; top: number; width: number; height: number }
  | { type: 'clear_region' }
  | { type: 'play_best'; uci: string };
