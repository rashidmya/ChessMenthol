import { describe, it, expect } from 'vitest';
import { settingsToCommands } from './settingsToCommands';
import { DEFAULTS } from './settings';

describe('settingsToCommands', () => {
  it('maps thinking time -> set_options movetime (ms) and lines -> MultiPV', () => {
    const cmds = settingsToCommands({ ...DEFAULTS, lines: 4, thinkingMs: 10000 });
    expect(cmds).toEqual([
      { type: 'set_options', movetime: 10000 },
      { type: 'set_engine_option', name: 'MultiPV', value: '4' },
    ]);
  });
});
