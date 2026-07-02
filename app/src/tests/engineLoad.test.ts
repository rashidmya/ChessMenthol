// app/src/tests/engineLoad.test.ts
// loadStockfish() build selection. The decisive case: WebKitGTK (the Linux Tauri
// webview) SIGSEGVs instantiating the Stockfish *wasm* (verified e2e against
// libwebkit2gtk-4.1 2.52), so the loader must pick the pure-JS asm.js build there.
// Every other webview uses the wasm build (threaded when SharedArrayBuffer is usable).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadStockfish } from '../engine/engine';

const MANIFEST = {
  full: { single: 'stockfish-18-single.js', multi: 'stockfish-18.js' },
  lite: { single: 'stockfish-18-lite-single.js', multi: 'stockfish-18-lite.js' },
  asm: 'stockfish-18-asm.js',
};
const CHROMIUM_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const WEBKITGTK_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15';

let lastWorkerUrl = '';
class FakeWorker {
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(url: string) { lastWorkerUrl = url; }
  postMessage(cmd: string): void {
    if (cmd === 'uci') queueMicrotask(() => this.onmessage?.({ data: 'uciok' }));
  }
  terminate(): void {}
}

function stub(ua: string, coi: boolean) {
  vi.stubGlobal('navigator', { userAgent: ua });
  vi.stubGlobal('crossOriginIsolated', coi);
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => MANIFEST })) as unknown as typeof fetch);
}

describe('loadStockfish() build selection by webview', () => {
  afterEach(() => { vi.unstubAllGlobals(); lastWorkerUrl = ''; });

  it('loads the pure-JS asm.js build under WebKitGTK (avoids the wasm SIGSEGV)', async () => {
    stub(WEBKITGTK_UA, true);
    await loadStockfish('lite');
    expect(lastWorkerUrl).toBe('/engine/stockfish-18-asm.js');
  });

  it('loads the single-threaded wasm build in Chromium without cross-origin isolation', async () => {
    stub(CHROMIUM_UA, false);
    await loadStockfish('lite');
    expect(lastWorkerUrl).toBe('/engine/stockfish-18-lite-single.js');
  });

  it('loads the threaded wasm build in a cross-origin-isolated Chromium', async () => {
    stub(CHROMIUM_UA, true);
    await loadStockfish('lite');
    expect(lastWorkerUrl).toBe('/engine/stockfish-18-lite.js');
  });
});
