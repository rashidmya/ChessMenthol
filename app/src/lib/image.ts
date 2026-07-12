// app/src/lib/image.ts
// Pure, structured-clone-safe RGBA image helpers (no Tauri). Split out of capture.ts so the
// browser extension can reuse them without dragging @tauri-apps/api.
import type { Region } from './region';

/** Plain-data RGBA image; structured-clone safe for the vision worker. */
export interface RgbaImage {
  data: Uint8ClampedArray; // RGBA, length === width*height*4
  width: number;
  height: number;
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
