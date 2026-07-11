import type { AdapterPosition } from './adapters/types';

/** Content script -> panel: a freshly-read position. */
export interface PositionMessage extends AdapterPosition {
  kind: 'position';
  site: 'chesscom' | 'lichess';
}
/** Panel -> background: capture the visible tab for the vision path. */
export interface CaptureRequest { kind: 'capture-request' }
/** Background -> panel: the captured frame as a PNG data URL. */
export interface CaptureResult { kind: 'capture-result'; dataUrl: string | null; error?: string }

/** Content script -> panel: whether the site adapter can currently read its board.
 *  ok:false => board element present but unparsed (offer the vision fallback). */
export interface AdapterStatusMessage { kind: 'adapter-status'; site: 'chesscom' | 'lichess'; ok: boolean; }

export type ExtMessage = PositionMessage | CaptureRequest | CaptureResult | AdapterStatusMessage;

export function isPositionMessage(m: ExtMessage): m is PositionMessage {
  return !!m && (m as PositionMessage).kind === 'position' && typeof (m as PositionMessage).fen === 'string';
}
