import type { StateFrame } from '@chessmenthol/core/lib/types';

export type PanelStatus =
  | 'analysis' | 'no_board' | 'adapter_broke' | 'capture_denied' | 'engine_unavailable';

/** Derive the single primary panel state, most-severe first. Error text is matched
 *  against the orchestrator's existing ErrorFrame wording (no core change). */
export function panelStatus(input: {
  lastError: string | null;
  visionStatus: StateFrame['visionStatus'] | undefined;
  adapterOk: boolean;
}): PanelStatus {
  const err = input.lastError ?? '';
  if (/engine failed to load|handshake timed out/i.test(err)) return 'engine_unavailable';
  if (/capture failed|screen capture/i.test(err)) return 'capture_denied';
  if (!input.adapterOk) return 'adapter_broke';
  if (input.visionStatus === 'no_board') return 'no_board';
  return 'analysis';
}
