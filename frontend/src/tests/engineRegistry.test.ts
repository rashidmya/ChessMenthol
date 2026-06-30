import { describe, it, expect, beforeEach } from 'vitest';
import { list, get, add, remove, engineName, BUNDLED, KEY, type EngineRecord } from '../lib/engineRegistry';

const ext = (over: Partial<EngineRecord> = {}): EngineRecord => ({
  id: 'e1', name: 'My Engine', kind: 'external', path: '/opt/x', ...over,
});

describe('engineRegistry', () => {
  beforeEach(() => localStorage.clear());

  it('lists only the bundled Stockfish by default', () => {
    expect(list()).toEqual([BUNDLED]);
    expect(BUNDLED).toEqual({ id: 'stockfish', name: 'Stockfish 18', kind: 'bundled' });
  });

  it('get() resolves the bundled engine and returns undefined for unknown ids', () => {
    expect(get('stockfish')).toEqual(BUNDLED);
    expect(get('nope')).toBeUndefined();
  });

  it('engineName() returns the name, falling back to the id', () => {
    expect(engineName('stockfish')).toBe('Stockfish 18');
    expect(engineName('mystery')).toBe('mystery');
  });

  it('add() appends an external engine and persists it', () => {
    add(ext());
    expect(list()).toHaveLength(2);
    expect(get('e1')).toEqual(ext());
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored).toEqual([ext()]);
  });

  it('add() ignores a bundled record and duplicate ids', () => {
    add({ id: 'stockfish', name: 'X', kind: 'bundled' });
    add(ext());
    add(ext({ name: 'dupe' }));
    expect(list()).toHaveLength(2); // bundled + one external
  });

  it('add() ignores an external record that claims the bundled id', () => {
    add(ext({ id: 'stockfish', name: 'Imposter' }));
    expect(list()).toEqual([BUNDLED]);
  });

  it('remove() drops an external engine but never the bundled one', () => {
    add(ext());
    remove('stockfish');
    expect(get('stockfish')).toEqual(BUNDLED);
    remove('e1');
    expect(get('e1')).toBeUndefined();
    expect(list()).toEqual([BUNDLED]);
  });

  it('hydrates external engines persisted by a previous session', () => {
    localStorage.setItem(KEY, JSON.stringify([ext({ id: 'saved', name: 'Saved' })]));
    expect(get('saved')?.name).toBe('Saved');
    expect(list()).toHaveLength(2);
  });

  it('falls back to bundled-only on corrupt storage', () => {
    localStorage.setItem(KEY, '{not json');
    expect(list()).toEqual([BUNDLED]);
  });

  it('ignores malformed stored records', () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'x' }, ext({ id: 'ok' })]));
    expect(list().map((e) => e.id)).toEqual(['stockfish', 'ok']);
  });

  it('ignores a stored record that claims the bundled id (no duplicate Stockfish)', () => {
    localStorage.setItem(KEY, JSON.stringify([ext({ id: 'stockfish', name: 'Imposter' }), ext({ id: 'ok' })]));
    expect(list().map((e) => e.id)).toEqual(['stockfish', 'ok']);
    expect(get('stockfish')).toEqual(BUNDLED);
  });
});
