import type { SiteAdapter } from './types';
export const lichessAdapter: SiteAdapter = {
  site: 'lichess',
  matches: (url) => /(^|\.)lichess\.org$/.test(hostOf(url)),
  readPosition: () => null,
  observe: () => () => {},
};
function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return ''; } }
