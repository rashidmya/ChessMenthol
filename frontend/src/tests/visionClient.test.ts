// frontend/src/tests/visionClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import { VisionWorkerClient, VisionTracker } from '../vision/visionClient';
import type { RgbaImage } from '../lib/capture';

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent | Event) => void) | null = null;
  posted: any[] = [];
  postMessage(msg: any) {
    this.posted.push(msg);
    if (msg.type === 'detect') {
      // echo back a canned AssembledPosition for the request id
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, ok: true, result: { fen: 'X', isLegal: true, status: 'valid', lowConfidence: [], move: null, orientation: 'white_bottom', sideToMove: 'white' } } } as MessageEvent));
    }
  }
  terminate() {}
}

// Worker that replies with an error envelope for every detect message.
class FailingWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent | Event) => void) | null = null;
  postMessage(msg: any) {
    if (msg.type === 'detect') {
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, ok: false, error: 'boom' } } as MessageEvent));
    }
  }
  terminate() {}
}

describe('VisionWorkerClient', () => {
  it('resolves detectPosition with the worker result for the matching id', async () => {
    const w = new FakeWorker();
    const client = new VisionWorkerClient(w as unknown as Worker);
    const img: RgbaImage = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const res = await client.detectPosition(img);
    expect(res?.fen).toBe('X');
    expect(w.posted.find((m) => m.type === 'detect')).toBeTruthy();
  });

  it('rejects detectPosition when the worker replies with an error envelope', async () => {
    const w = new FailingWorker();
    const client = new VisionWorkerClient(w as unknown as Worker);
    const img: RgbaImage = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    await expect(client.detectPosition(img)).rejects.toThrow('boom');
  });

  it('rejects all pending promises when the worker emits an error event', async () => {
    const w = new FakeWorker();
    // Never reply to detect; only the worker error should settle the promise.
    w.postMessage = function (this: FakeWorker, msg: any) { this.posted.push(msg); };
    const client = new VisionWorkerClient(w as unknown as Worker);
    const img: RgbaImage = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const pending = client.detectPosition(img);
    w.onerror?.({ message: 'worker exploded' } as ErrorEvent);
    await expect(pending).rejects.toThrow('worker exploded');
  });
});

describe('VisionTracker facade', () => {
  it('calls capturer.grab() and forwards the image to the worker', async () => {
    const w = new FakeWorker();
    const client = new VisionWorkerClient(w as unknown as Worker);
    const capturer = {
      setRegion: vi.fn(),
      grab: vi.fn(async () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
      grabFullDesktop: vi.fn(async () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 })),
    };
    const tracker = new VisionTracker(capturer as any, client);
    const ap = await tracker.detectPosition();
    expect(ap?.fen).toBe('X');
    expect(capturer.grab).toHaveBeenCalledOnce();
  });
});
