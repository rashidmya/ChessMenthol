// frontend/src/vision/visionClient.ts
import type { RgbaImage, Capturer } from '../lib/capture';
import type { Region } from '../lib/region';
import type { AssembledPosition } from './position';
import type { Orientation } from './types';

type Pending = { resolve: (v: AssembledPosition | null) => void; reject: (e: unknown) => void };

/** Promise-per-message wrapper over the vision worker. */
export class VisionWorkerClient {
  private seq = 0;
  private pending = new Map<number, Pending>();
  constructor(private worker: Worker) {
    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ok, result, error } = e.data as { id: number; ok: boolean; result?: AssembledPosition | null; error?: string };
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      ok ? p.resolve(result ?? null) : p.reject(new Error(error));
    };
    // Backstop for an import-time / top-level worker failure that never reaches
    // onmessage (e.g. the worker module itself fails to load): reject every
    // in-flight detect so callers don't hang. NOTE: a one-time ONNX init failure
    // bricks all subsequent detects too (the rejected trackerPromise is cached),
    // which is acceptable for a file-load failure.
    this.worker.onerror = (e: ErrorEvent | Event) => {
      const message = (e as ErrorEvent).message ?? 'vision worker error';
      for (const p of this.pending.values()) p.reject(new Error(message));
      this.pending.clear();
    };
  }
  detectPosition(image: RgbaImage): Promise<AssembledPosition | null> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // transfer the pixel buffer to avoid a copy
      // safe: capturer.grab() allocates fresh bytes each call
      this.worker.postMessage({ id, type: 'detect', image }, [image.data.buffer]);
    });
  }
  setSideOverride(white: boolean | null): void { this.worker.postMessage({ type: 'setSideOverride', white }); }
  setOrientationOverride(o: Orientation | null): void { this.worker.postMessage({ type: 'setOrientationOverride', orientation: o }); }
  reset(): void { this.worker.postMessage({ type: 'reset' }); }
}

/** The tracker facade the orchestrator injects: capture (main) + detect (worker). */
export class VisionTracker {
  constructor(private capturer: Capturer, private client: VisionWorkerClient) {}
  setRegion(region: Region | null): void { this.capturer.setRegion(region); }
  setSideOverride(white: boolean | null): void { this.client.setSideOverride(white); }
  setOrientationOverride(o: Orientation | null): void { this.client.setOrientationOverride(o); }
  reset(): void { this.client.reset(); }
  /** The full desktop frame for region calibration, bypassing the active crop. */
  async grabFullDesktop(): Promise<RgbaImage> { return this.capturer.grabFullDesktop(); }
  async detectPosition(): Promise<AssembledPosition | null> {
    const image = await this.capturer.grab();
    return this.client.detectPosition(image);
  }
}
