import { type ToolResult, ok, err, messageFrom } from './result';

/** Pixel buffer in the layout `ImageData`/canvas produce: RGBA, row-major. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export const NO_QR_FOUND_MESSAGE =
  'No QR code was found in that image. Use a sharp, well-lit picture of the whole code, including its white border, and crop out other content.';

/**
 * Longest side tried first. Phone photos are often 4000px+; decoding that is slow and
 * no more reliable than a mid-size copy, so scan a reduced copy first and fall back to
 * the original size only if that fails.
 */
export const SCAN_SIZES = [1000, 1800] as const;

/** Target dimensions that fit within `maxSide` without upscaling. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Decodes the first QR code found in a pixel buffer. jsQR is loaded on demand so visitors
 * to other tools never download it.
 */
export async function decodeQrFromPixels(pixels: Pixels): Promise<ToolResult<string>> {
  if (pixels.width < 21 || pixels.height < 21) {
    return err('That image is too small to contain a QR code. The smallest QR code is 21×21 modules.');
  }
  if (pixels.data.length !== pixels.width * pixels.height * 4) {
    return err('The image data was incomplete, so it could not be scanned. Try a different file.');
  }

  try {
    const { default: jsQR } = await import('jsqr');
    const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
    if (!result || result.data === '') return err(NO_QR_FOUND_MESSAGE);
    return ok(result.data);
  } catch (error) {
    return err(messageFrom(error, 'The QR code reader failed to start. Reload the page and try again.'));
  }
}
