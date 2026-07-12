// app/src/lib/capture.ts
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Region } from './region';
import { cropImage, decodeCaptureBuffer, type RgbaImage } from './image';

export type { RgbaImage };

/** True when the native capture command is available (running inside Tauri). */
export function hasNativeCapture(): boolean {
  return isTauri();
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
