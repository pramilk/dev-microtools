/**
 * Scans a canvas's alpha channel for any non-opaque pixel. Only worth the pixel-by-pixel
 * cost when converting to a format with no alpha channel at all (JPEG) from a source that
 * could plausibly have real transparency — callers gate the call on that, this just does
 * the scan.
 */
export function canvasHasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}
