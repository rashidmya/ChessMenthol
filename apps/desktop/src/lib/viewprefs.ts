export interface ViewPrefs { evalBar: boolean; lines: boolean; arrows: boolean; feedback: boolean; }
export const DEFAULT_VIEW_PREFS: ViewPrefs = { evalBar: true, lines: true, arrows: true, feedback: true };
export const KEY = 'chessmenthol.viewPrefs';
export function loadViewPrefs(): ViewPrefs {
  try {
    return { ...DEFAULT_VIEW_PREFS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULT_VIEW_PREFS };
  }
}
export function saveViewPrefs(p: ViewPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore quota/availability errors */ }
}
