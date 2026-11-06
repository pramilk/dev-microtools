import { fitWithin, type Pixels } from '../../lib/tools/qrDecode';
import { type ToolResult, ok, err, messageFrom } from '../../lib/tools/result';

/**
 * Draws an image file onto a canvas no larger than `maxSide` on its longest edge and
 * returns the raw RGBA pixels. DOM-bound (`createImageBitmap`, `<canvas>`), so it lives
 * with the islands rather than in `lib/tools`.
 */
export async function readImagePixels(file: Blob, maxSide: number): Promise<ToolResult<Pixels>> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    return err(messageFrom(error, "That file could not be opened as an image. Try a PNG, JPEG or WebP screenshot or photo."));
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return err('This browser could not create a drawing surface to scan the image.');
    // QR codes are often transparent PNGs; paint white underneath so "no pixel" does not read as black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    return ok({ data: image.data, width, height });
  } catch (error) {
    return err(messageFrom(error, 'The image could not be read for scanning.'));
  } finally {
    bitmap.close();
  }
}
