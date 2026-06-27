import { describe, it, expect, beforeEach } from 'vitest';
import { loadViewPrefs, saveViewPrefs, DEFAULT_VIEW_PREFS, KEY } from '../lib/viewprefs';
describe('viewprefs', () => {
  beforeEach(() => localStorage.clear());
  it('returns defaults when nothing stored', () => {
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
  });
  it('round-trips saved prefs', () => {
    saveViewPrefs({ ...DEFAULT_VIEW_PREFS, evalBar: false });
    expect(loadViewPrefs().evalBar).toBe(false);
    expect(loadViewPrefs().lines).toBe(true); // others keep defaults
  });
  it('merges partial/legacy stored prefs over defaults', () => {
    localStorage.setItem(KEY, JSON.stringify({ lines: false }));
    const p = loadViewPrefs();
    expect(p.lines).toBe(false);
    expect(p.evalBar).toBe(true);   // missing key falls back to default
  });
  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
  });
});
