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

export type ExtMessage = PositionMessage | CaptureRequest | CaptureResult;

export function isPositionMessage(m: ExtMessage): m is PositionMessage {
  return !!m && (m as PositionMessage).kind === 'position' && typeof (m as PositionMessage).fen === 'string';
}
