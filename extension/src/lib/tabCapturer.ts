import { cropImage, type RgbaImage } from '@core/lib/capture';
import type { Region } from '@core/lib/region';

export type CaptureFn = () => Promise<string | null>;   // -> PNG data URL
export type DecodeFn = (dataUrl: string) => Promise<RgbaImage>;

/** Default decode: data URL -> ImageBitmap -> OffscreenCanvas -> fresh RGBA. */
export const decodeDataUrl: DecodeFn = async (dataUrl) => {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return { data, width, height }; // getImageData().data is a fresh Uint8ClampedArray
};

/** Drop-in for the desktop Capturer: same grab/grabFullDesktop/setRegion surface. */
export class TabCapturer {
  private region: Region | null = null;
  constructor(private requestCapture: CaptureFn, private decode: DecodeFn = decodeDataUrl) {}

  setRegion(region: Region | null): void { this.region = region; }

  async grabFullDesktop(): Promise<RgbaImage> {
    const dataUrl = await this.requestCapture();
    if (!dataUrl) throw new Error('captureVisibleTab returned no image (permission or restricted page?)');
    return this.decode(dataUrl);
  }

  async grab(): Promise<RgbaImage> {
    const full = await this.grabFullDesktop();
    return this.region === null ? full : cropImage(full, this.region);
  }
}
