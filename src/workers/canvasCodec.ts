import type { RgbaImageData } from '../lib/tools/imageCompress';
import type { RasterCodec } from '../lib/tools/pdfCompressEngine';

/**
 * Browser image codecs for the PDF tools' workers, backed by `createImageBitmap` +
 * `OffscreenCanvas` — shared by PDF Compressor and PDF Image Extractor. Lives beside the
 * workers (not in `lib/`) because it needs the real canvas APIs, which jsdom lacks; the
 * engines take it as an injected `RasterCodec` so they stay unit-testable.
 */

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser can’t draw images in a background worker.');
  return context;
}

async function canvasBytes(canvas: OffscreenCanvas, type: string, quality?: number): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type, quality });
  return new Uint8Array(await blob.arrayBuffer());
}

function canvasFrom(image: RgbaImageData): OffscreenCanvas {
  const canvas = new OffscreenCanvas(image.width, image.height);
  context2d(canvas).putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas;
}

/** The engine's `RasterCodec`, backed by `createImageBitmap` + `OffscreenCanvas`. */
export const offscreenCanvasCodec: RasterCodec = {
  async decodeJpeg(bytes, width, height) {
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
    // `imageOrientation: 'none'`: a PDF never applies a JPEG's EXIF rotation, so honouring
    // it here would rotate the image relative to how every PDF viewer draws it.
    // Resizing during decode avoids ever allocating a full-size canvas for a huge scan;
    // browsers that ignore the resize hint are caught by the size check below.
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'none', resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    try {
      const canvas = new OffscreenCanvas(width, height);
      const context = context2d(canvas);
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      const { data } = context.getImageData(0, 0, width, height);
      return { data, width, height };
    } finally {
      bitmap.close();
    }
  },
  encodeJpeg: (image, quality) => canvasBytes(canvasFrom(image), 'image/jpeg', quality),
  encodePng: (image) => canvasBytes(canvasFrom(image), 'image/png'),
};

/** A deterministic landscape "photo" with fine noise, so it's large as a high-quality JPEG
 *  the way a real camera photo is — a flat gradient would already compress to almost nothing. */
export async function samplePhotoJpeg(width = 2400, height = 1600): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = context2d(canvas);

  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#3a7bd5');
  sky.addColorStop(0.55, '#a8d0f0');
  sky.addColorStop(1, '#f4e3c1');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const hills: [string, number, number][] = [
    ['#6b8f71', 0.62, 140],
    ['#4f7355', 0.72, 110],
    ['#355a3c', 0.84, 80],
  ];
  for (const [color, baseline, amplitude] of hills) {
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, height);
    for (let x = 0; x <= width; x += 20) {
      context.lineTo(x, height * baseline + Math.sin(x / 190 + amplitude) * amplitude * 0.6 + Math.sin(x / 67) * 18);
    }
    context.lineTo(width, height);
    context.closePath();
    context.fill();
  }

  const pixels = context.getImageData(0, 0, width, height);
  let seed = 1234567;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const grain = ((seed >>> 16) % 25) - 12;
    pixels.data[i] += grain;
    pixels.data[i + 1] += grain;
    pixels.data[i + 2] += grain;
  }
  context.putImageData(pixels, 0, 0);

  return canvasBytes(canvas, 'image/jpeg', 0.95);
}
