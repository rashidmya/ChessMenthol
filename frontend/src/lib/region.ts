export interface Region { left: number; top: number; width: number; height: number; }
export interface Box { x: number; y: number; w: number; h: number; }
export interface Size { width: number; height: number; }

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/** Map a drag box (in displayed-image pixels, w/h may be negative) to a region in
 *  true desktop pixels. Normalizes reversed drags and clamps to the image bounds. */
export function toDesktopRegion(box: Box, displayed: Size, real: Size): Region {
  const x0 = clamp(Math.min(box.x, box.x + box.w), 0, displayed.width);
  const y0 = clamp(Math.min(box.y, box.y + box.h), 0, displayed.height);
  const x1 = clamp(Math.max(box.x, box.x + box.w), 0, displayed.width);
  const y1 = clamp(Math.max(box.y, box.y + box.h), 0, displayed.height);
  const kx = real.width / displayed.width;
  const ky = real.height / displayed.height;
  return {
    left: Math.round(x0 * kx),
    top: Math.round(y0 * ky),
    width: Math.round((x1 - x0) * kx),
    height: Math.round((y1 - y0) * ky),
  };
}
