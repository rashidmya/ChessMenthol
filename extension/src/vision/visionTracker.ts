import type { VisionTrackerLike } from '@core/core/orchestrator';
import type { AssembledPosition } from '@core/vision/position';
import type { RgbaImage } from '@core/lib/image';
import type { Region } from '@core/lib/region';
import { VisionWorkerClient } from '@core/vision/visionClient';
import { TabCapturer, type CaptureFn } from '../lib/tabCapturer';

interface CapturerLike {
  grab(): Promise<RgbaImage>;
  grabFullDesktop(): Promise<RgbaImage>;
  setRegion(r: Region | null): void;
}

/** Extension VisionTrackerLike: capture the tab, detect via the reused worker client. */
export class TabTracker implements VisionTrackerLike {
  constructor(private capturer: CapturerLike, private client: VisionWorkerClient) {}
  setRegion(r: { left: number; top: number; width: number; height: number } | null): void { this.capturer.setRegion(r); }
  setSideOverride(white: boolean | null): void { this.client.setSideOverride(white); }
  setOrientationOverride(o: 'white_bottom' | 'black_bottom' | null): void { this.client.setOrientationOverride(o); }
  reset(): void { this.client.reset(); }
  grabFullDesktop(): Promise<RgbaImage> { return this.capturer.grabFullDesktop(); }
  async detectPosition(): Promise<AssembledPosition | null> {
    const image = await this.capturer.grab();
    return this.client.detectPosition(image);
  }
}

/** Build a live tracker: spawn the vision worker, wrap TabCapturer + VisionWorkerClient. */
export function makeTabTracker(requestCapture: CaptureFn): TabTracker {
  const worker = new Worker(new URL('./vision-worker.ts', import.meta.url), { type: 'module' });
  return new TabTracker(new TabCapturer(requestCapture), new VisionWorkerClient(worker));
}
