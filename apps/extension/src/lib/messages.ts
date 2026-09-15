import type { AdapterPosition } from './adapters/types';

/** Content script -> panel: a freshly-read position. */
export interface PositionMessage extends AdapterPosition {
  kind: 'position';
  site: 'chesscom' | 'lichess';
}
/** Panel -> background: capture the visible tab for the vision path. `windowId` is
 *  the panel's own window so the broker never captures a different window's tab. */
export interface CaptureRequest { kind: 'capture-request'; windowId?: number }
/** Background -> panel: the captured frame as a PNG data URL. */
export interface CaptureResult { kind: 'capture-result'; dataUrl: string | null; error?: string }

/** Content script -> panel: whether the site adapter can currently read its board.
 *  ok:false => board element present but unparsed (offer the vision fallback). */
export interface AdapterStatusMessage { kind: 'adapter-status'; site: 'chesscom' | 'lichess'; ok: boolean; }

/** Panel -> content script (via tabs.sendMessage): "what is on the board right now?"
 *  Answered with a PositionMessage, or NoPositionReply when nothing readable is there. */
export interface PositionRequest { kind: 'position-request' }
export interface NoPositionReply { kind: 'no-position'; boardPresent: boolean }

export type ExtMessage =
  | PositionMessage | CaptureRequest | CaptureResult | AdapterStatusMessage
  | PositionRequest | NoPositionReply;

export function isPositionMessage(m: ExtMessage): m is PositionMessage {
  return !!m && (m as PositionMessage).kind === 'position' && typeof (m as PositionMessage).fen === 'string';
}
