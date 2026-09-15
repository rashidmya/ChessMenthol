import { cropImage, type RgbaImage } from '@chessmenthol/core/lib/image';
import type { Region } from '@chessmenthol/core/lib/region';

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

// Chrome allows at most 2 captureVisibleTab calls per fixed 1 s window and rejects with this text.
const QUOTA_RE = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/;
const QUOTA_RETRY_MS = 1000;

/** Drop-in for the desktop Capturer: same grab/grabFullDesktop/setRegion surface. */
export class TabCapturer {
  private region: Region | null = null;
  constructor(
    private requestCapture: CaptureFn,
    private decode: DecodeFn = decodeDataUrl,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  setRegion(region: Region | null): void { this.region = region; }

  async grabFullDesktop(): Promise<RgbaImage> {
    let dataUrl: string | null;
    try {
      dataUrl = await this.requestCapture();
    } catch (err) {
      // Three captures inside one second (rapid re-clicks) trip Chrome's quota; waiting out the window clears it.
      if (!QUOTA_RE.test(String(err))) throw err;
      await this.sleep(QUOTA_RETRY_MS);
      dataUrl = await this.requestCapture();
    }
    if (!dataUrl) throw new Error('captureVisibleTab returned no image (permission or restricted page?)');
    return this.decode(dataUrl);
  }

  async grab(): Promise<RgbaImage> {
    const full = await this.grabFullDesktop();
    return this.region === null ? full : cropImage(full, this.region);
  }
}
