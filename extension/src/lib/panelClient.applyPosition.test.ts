import { describe, it, expect, vi } from 'vitest';
import { applyPosition } from './panelClient';
import type { Command } from '@chessmenthol/core/lib/types';

describe('applyPosition', () => {
  it('sends set_fen then enables analysis', () => {
    const cmds: Command[] = [];
    applyPosition((c) => cmds.push(c), { kind: 'position', site: 'lichess', fen: 'FEN', orientation: 'white', turn: 'w' });
    expect(cmds).toEqual([
      { type: 'set_fen', fen: 'FEN' },
      { type: 'set_analysis_enabled', enabled: true },
    ]);
  });
});
