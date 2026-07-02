import { describe, it, expect } from 'vitest';
import { parseOption, parseOptions, formatSetOption, type UciOption } from '../engine/uciOptions';

describe('parseOption', () => {
  it('parses a spin option with default/min/max', () => {
    expect(parseOption('option name Threads type spin default 1 min 1 max 1024')).toEqual<UciOption>({
      name: 'Threads', type: 'spin', default: '1', min: 1, max: 1024,
    });
  });
  it('parses a check option', () => {
    expect(parseOption('option name Ponder type check default false')).toEqual<UciOption>({
      name: 'Ponder', type: 'check', default: 'false',
    });
  });
  it('parses a combo option with vars', () => {
    expect(parseOption('option name Style type combo default Normal var Solid var Normal var Risky')).toEqual<UciOption>({
      name: 'Style', type: 'combo', default: 'Normal', vars: ['Solid', 'Normal', 'Risky'],
    });
  });
  it('parses combo vars with multi-word var values', () => {
    expect(parseOption('option name Mode type combo var White Wins var Draw var Black Wins')).toEqual<UciOption>({
      name: 'Mode', type: 'combo', vars: ['White Wins', 'Draw', 'Black Wins'],
    });
  });
  it('parses a spin option with negative min', () => {
    expect(parseOption('option name Contempt type spin default 0 min -100 max 100')).toEqual<UciOption>({
      name: 'Contempt', type: 'spin', default: '0', min: -100, max: 100,
    });
  });
  it('parses a string option (incl. <empty> default)', () => {
    expect(parseOption('option name SyzygyPath type string default <empty>')).toEqual<UciOption>({
      name: 'SyzygyPath', type: 'string', default: '<empty>',
    });
  });
  it('parses a button option (no default)', () => {
    expect(parseOption('option name Clear Hash type button')).toEqual<UciOption>({
      name: 'Clear Hash', type: 'button',
    });
  });
  it('keeps spaces in option names', () => {
    expect(parseOption('option name UCI_LimitStrength type check default false')?.name).toBe('UCI_LimitStrength');
    expect(parseOption('option name Use NNUE type check default true')?.name).toBe('Use NNUE');
  });
  it('returns null for non-option / malformed lines', () => {
    expect(parseOption('id name Stockfish 17.1')).toBeNull();
    expect(parseOption('uciok')).toBeNull();
    expect(parseOption('option name Foo')).toBeNull(); // no type
  });
});

describe('parseOptions', () => {
  it('parses many lines, skipping non-options and unparseable', () => {
    const lines = [
      'id name X', 'option name Threads type spin default 1 min 1 max 512',
      'garbage', 'option name Ponder type check default false', 'uciok',
    ];
    expect(parseOptions(lines).map((o) => o.name)).toEqual(['Threads', 'Ponder']);
  });
});

describe('formatSetOption', () => {
  it('formats value options', () => {
    expect(formatSetOption('Threads', 4)).toBe('setoption name Threads value 4');
    expect(formatSetOption('SyzygyPath', '/tb')).toBe('setoption name SyzygyPath value /tb');
  });
  it('formats booleans as true/false', () => {
    expect(formatSetOption('Ponder', true)).toBe('setoption name Ponder value true');
    expect(formatSetOption('Ponder', false)).toBe('setoption name Ponder value false');
  });
  it('formats a button (no value)', () => {
    expect(formatSetOption('Clear Hash', undefined)).toBe('setoption name Clear Hash');
  });
});
