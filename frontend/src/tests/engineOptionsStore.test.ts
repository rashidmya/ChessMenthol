import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSchema, setSchema, getOverrides, setOption, resetOption, resetAll,
  effectiveValues, clear, onSchemaChange, SCHEMA_KEY, OVERRIDES_KEY,
} from '../lib/engineOptions';
import type { UciOption } from '../engine/uciOptions';

const schema: UciOption[] = [
  { name: 'Threads', type: 'spin', default: '1', min: 1, max: 8 },
  { name: 'MultiPV', type: 'spin', default: '1', min: 1, max: 5 },
  { name: 'Ponder', type: 'check', default: 'false' },
  { name: 'Clear Hash', type: 'button' },
];

describe('engineOptions', () => {
  beforeEach(() => localStorage.clear());

  it('caches + reads a schema per engine id', () => {
    expect(getSchema('e1')).toBeNull();
    setSchema('e1', schema);
    expect(getSchema('e1')).toEqual(schema);
    expect(JSON.parse(localStorage.getItem(SCHEMA_KEY)!).e1).toEqual(schema);
  });

  it('stores + reads overrides per engine id', () => {
    setOption('e1', 'Threads', '4');
    expect(getOverrides('e1')).toEqual({ Threads: '4' });
    expect(JSON.parse(localStorage.getItem(OVERRIDES_KEY)!).e1).toEqual({ Threads: '4' });
  });

  it('effectiveValues = engine defaults merged with overrides', () => {
    setSchema('e1', schema);
    setOption('e1', 'MultiPV', '3');
    expect(effectiveValues('e1')).toEqual({ Threads: '1', MultiPV: '3', Ponder: 'false' });
    // button (no default) is omitted; override wins over default.
  });

  it('resetOption / resetAll clear overrides', () => {
    setSchema('e1', schema);
    setOption('e1', 'Threads', '4'); setOption('e1', 'MultiPV', '3');
    resetOption('e1', 'Threads');
    expect(getOverrides('e1')).toEqual({ MultiPV: '3' });
    resetAll('e1');
    expect(getOverrides('e1')).toEqual({});
  });

  it('isolates engines by id', () => {
    setOption('e1', 'Threads', '4'); setOption('e2', 'Threads', '2');
    expect(getOverrides('e1')).toEqual({ Threads: '4' });
    expect(getOverrides('e2')).toEqual({ Threads: '2' });
  });

  it('clear() drops schema + overrides for one engine', () => {
    setSchema('e1', schema); setOption('e1', 'Threads', '4');
    setSchema('e2', schema);
    clear('e1');
    expect(getSchema('e1')).toBeNull();
    expect(getOverrides('e1')).toEqual({});
    expect(getSchema('e2')).toEqual(schema); // unaffected
  });

  it('falls back to empty on corrupt storage', () => {
    localStorage.setItem(SCHEMA_KEY, '{bad'); localStorage.setItem(OVERRIDES_KEY, '{bad');
    expect(getSchema('e1')).toBeNull();
    expect(getOverrides('e1')).toEqual({});
  });

  it('onSchemaChange fires on setSchema and unsubscribe stops it', () => {
    const ids: string[] = [];
    const unsub = onSchemaChange((id) => ids.push(id));
    try {
      setSchema('e1', schema);
      expect(ids).toEqual(['e1']);
      unsub();
      setSchema('e2', schema);
      expect(ids).toEqual(['e1']); // no further notifications after unsubscribe
    } finally {
      unsub(); // idempotent (Set.delete of a missing element is a no-op)
    }
  });
});
