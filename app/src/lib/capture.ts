// app/src/lib/capture.ts
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Region } from './region';

/** Plain-data RGBA image; structured-clone safe for the vision worker. */
export interface RgbaImage {
  data: Uint8ClampedArray; // RGBA, length === width*height*4
  width: number;
  height: number;
}

/** True when the native capture command is available (running inside Tauri). */
export function hasNativeCapture(): boolean {
  return isTauri();
}

/** Decode the [width u32 LE][height u32 LE][RGBA...] buffer from capture_frame. */
export function decodeCaptureBuffer(buf: ArrayBuffer): RgbaImage {
  const v = new DataView(buf);
  const width = v.getUint32(0, true);
  const height = v.getUint32(4, true);
  // Copy out of the IPC buffer so the worker can take ownership of the bytes.
  const data = new Uint8ClampedArray(buf.slice(8));
  return { data, width, height };
}

/** Crop an RGBA image to a region, clamped to the image bounds. */
export function cropImage(src: RgbaImage, region: Region): RgbaImage {
  const left = Math.max(0, Math.min(region.left, src.width));
  const top = Math.max(0, Math.min(region.top, src.height));
  const width = Math.max(0, Math.min(region.width, src.width - left));
  const height = Math.max(0, Math.min(region.height, src.height - top));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcStart = ((top + y) * src.width + left) * 4;
    out.set(src.data.subarray(srcStart, srcStart + width * 4), y * width * 4);
  }
  return { data: out, width, height };
}

/** The main-thread screen capturer: grabs the full desktop and crops to a region. */
export class Capturer {
  private region: Region | null = null;

  setRegion(region: Region | null): void {
    this.region = region;
  }

  async grabFullDesktop(): Promise<RgbaImage> {
    const buf = (await invoke('capture_frame')) as ArrayBuffer;
    return decodeCaptureBuffer(buf);
  }

  /** Full desktop cropped to the active region (or the whole frame if unset). */
  async grab(): Promise<RgbaImage> {
    const full = await this.grabFullDesktop();
    return this.region === null ? full : cropImage(full, this.region);
  }
}
