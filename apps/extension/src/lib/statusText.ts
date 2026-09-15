import type { PanelStatus } from './panelStatus';

/** Card copy per non-analysis panel status; `action: 'capture'` renders a Capture button. */
export const STATUS_TEXT: Record<Exclude<PanelStatus, 'analysis'>, { msg: string; action?: 'capture' }> = {
  engine_unavailable: { msg: 'Analysis engine unavailable. Board reconstruction still works.' },
  capture_denied: { msg: "Couldn't capture this page (try a normal web page and click again).", action: 'capture' },
  adapter_broke: { msg: "Can't read this site's board — capture it instead.", action: 'capture' },
  no_board: { msg: 'No chessboard detected. Make the board fully visible and try again.', action: 'capture' },
  unreadable: { msg: "Board found but the pieces couldn't be read — wait for the move animation to finish and try again.", action: 'capture' },
};
