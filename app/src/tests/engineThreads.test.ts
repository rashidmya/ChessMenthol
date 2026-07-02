// app/src/tests/engineThreads.test.ts
// On WebKitGTK (the Linux Tauri webview) the engine runs as the single-threaded
// asm.js build — wasm crashes the web process there (see engineLoad.test.ts), and
// asm.js has no threads. So threadsAvailable() must report false under WebKitGTK
// even if a future WebKitGTK exposes SharedArrayBuffer + crossOriginIsolated, so
// nothing tries to set Threads > 1 on an inherently single-threaded engine.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { threadsAvailable } from '../engine/engine';

// Chrome/Chromium (incl. Tauri's WebView2 on Windows): has a Chrome token.
const CHROMIUM_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// WebKitGTK (the Linux Tauri webview): AppleWebKit on Linux, NO Chrome token.
const WEBKITGTK_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15';

describe('threadsAvailable() webview gating', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is true in a cross-origin-isolated Chromium context (SAB + COI usable)', () => {
    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('navigator', { userAgent: CHROMIUM_UA });
    expect(threadsAvailable()).toBe(true);
  });

  it('is false under WebKitGTK even when SharedArrayBuffer + crossOriginIsolated are present', () => {
    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('navigator', { userAgent: WEBKITGTK_UA });
    expect(threadsAvailable()).toBe(false);
  });
});
