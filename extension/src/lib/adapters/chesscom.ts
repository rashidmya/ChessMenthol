import type { SiteAdapter } from './types';
export const chesscomAdapter: SiteAdapter = {
  site: 'chesscom',
  matches: (url) => /(^|\.)chess\.com$/.test(hostOf(url)),
  readPosition: () => null,
  observe: () => () => {},
};
function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return ''; } }
