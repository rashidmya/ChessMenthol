import type { VisionTrackerLike } from '@chessmenthol/core/core/orchestrator';
import type { AssembledPosition } from '@chessmenthol/core/vision/position';
import type { RgbaImage } from '@chessmenthol/core/lib/image';
import type { Region } from '@chessmenthol/core/lib/region';
import { VisionWorkerClient } from '@chessmenthol/core/vision/visionClient';
import { writable, type Readable } from 'svelte/store';
import { TabCapturer, type CaptureFn } from '../lib/tabCapturer';

interface CapturerLike {
  grab(): Promise<RgbaImage>;
  grabFullDesktop(): Promise<RgbaImage>;
  setRegion(r: Region | null): void;
}

/** Extension VisionTrackerLike: capture the tab, detect via the reused worker client.
 *  One capture at a time: a second detectPosition() while one is running joins it
 *  instead of taking another screenshot (rapid re-clicks must not trip Chrome's
 *  capture quota, and a burst costs one PNG decode + one inference), and `busy` lets
 *  the panel show/disable the button. A joiner receives the result of the capture
 *  already in flight, i.e. computed with the region/side settings as of that
 *  capture's start. */
export class TabTracker implements VisionTrackerLike {
  private inflight: Promise<AssembledPosition | null> | null = null;
  private busyStore = writable(false);
  readonly busy: Readable<boolean> = { subscribe: this.busyStore.subscribe };

  constructor(private capturer: CapturerLike, private client: VisionWorkerClient) {}
  setRegion(r: { left: number; top: number; width: number; height: number } | null): void { this.capturer.setRegion(r); }
  setSideOverride(white: boolean | null): void { this.client.setSideOverride(white); }
  setOrientationOverride(o: 'white_bottom' | 'black_bottom' | null): void { this.client.setOrientationOverride(o); }
  reset(): void { this.client.reset(); }
  grabFullDesktop(): Promise<RgbaImage> { return this.capturer.grabFullDesktop(); }
  detectPosition(): Promise<AssembledPosition | null> {
    if (this.inflight) return this.inflight;
    this.busyStore.set(true);
    this.inflight = (async () => {
      try {
        const image = await this.capturer.grab();
        // `await` (not a bare return) so `finally` waits for detection, not just the grab
        return await this.client.detectPosition(image);
      } finally {
        this.inflight = null;
        this.busyStore.set(false);
      }
    })();
    return this.inflight;
  }
}

/** Build a live tracker: spawn the vision worker, wrap TabCapturer + VisionWorkerClient. */
export function makeTabTracker(requestCapture: CaptureFn): TabTracker {
  const worker = new Worker(new URL('./vision-worker.ts', import.meta.url), { type: 'module' });
  return new TabTracker(new TabCapturer(requestCapture), new VisionWorkerClient(worker));
}
