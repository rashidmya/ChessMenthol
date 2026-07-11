import type { Command } from '@core/lib/types';
import type { Settings } from './settings';

/** The engine-affecting settings as orchestrator commands. movetime is ms
 *  (verbatim into the session's timeMs); lines maps to the MultiPV UCI option. */
export function settingsToCommands(s: Settings): Command[] {
  return [
    { type: 'set_options', movetime: s.thinkingMs },
    { type: 'set_engine_option', name: 'MultiPV', value: String(s.lines) },
  ];
}
