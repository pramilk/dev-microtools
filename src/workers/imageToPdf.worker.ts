import type { ImageToPdfOptions } from '../lib/tools/imageToPdf';
import { withExifOrientation } from '../lib/tools/imageToPdf';
import { imagesToPdf, type ImageDecodeCodec, type ImageSourceInput, type ImageToPdfOutput } from '../lib/tools/imageToPdfEngine';
import { browserImageCodec, samplePhotoJpeg } from './canvasCodec';
import { listenForRequests, type WorkerScope } from './workerGlue';

/**
 * Image to PDF's work runs here, off the main thread: decoding a batch of large photos and
 * writing the PDF can take seconds, which on the main thread would freeze the page (an INP
 * failure). Created on first use, so pdf-lib is never part of any page load. Stateless:
 * every build request carries the images' bytes (transferred, not copied).
 */
export type ImageToPdfWorkerRequest = { kind: 'build'; sources: ImageSourceInput[]; options: ImageToPdfOptions } | { kind: 'samples' };

export type ImageToPdfWorkerResult =
  | { kind: 'build'; ok: true; output: ImageToPdfOutput }
  | { kind: 'build'; ok: false; error: string }
  | { kind: 'samples'; files: { name: string; type: string; bytes: Uint8Array }[] };

function canvas2d(width: number, height: number): { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser can’t draw images in a background worker.');
  return { canvas, context };
}

async function bytesOf(canvas: OffscreenCanvas, type: string, quality?: number): Promise<Uint8Array> {
  return new Uint8Array(await (await canvas.convertToBlob({ type, quality })).arrayBuffer());
}

/** A bar chart with a transparent background, as a PNG — the screenshot/diagram case. */
async function sampleChartPng(): Promise<Uint8Array> {
  const { canvas, context } = canvas2d(900, 560);
  context.fillStyle = '#0b6e80';
  context.font = 'bold 34px sans-serif';
  context.fillText('Quarterly sales', 40, 60);
  const bars = [0.45, 0.7, 0.55, 0.9];
  bars.forEach((value, i) => {
    context.fillStyle = i % 2 ? '#3cbcd4' : '#0b6e80';
    const height = value * 380;
    context.fillRect(80 + i * 200, 500 - height, 120, height);
    context.fillStyle = '#57636f';
    context.font = '24px sans-serif';
    context.fillText(`Q${i + 1}`, 120 + i * 200, 540);
  });
  context.fillStyle = '#57636f';
  context.fillRect(60, 500, 800, 3);
  return bytesOf(canvas, 'image/png');
}

/**
 * A portrait receipt stored sideways with EXIF orientation 6 — exactly how a phone saves a
 * photo taken in portrait — so the example shows the tool turning it upright.
 */
async function sampleReceiptJpeg(): Promise<Uint8Array> {
  const upright = canvas2d(800, 1200);
  const { context } = upright;
  context.fillStyle = '#f4f1ea';
  context.fillRect(0, 0, 800, 1200);
  context.fillStyle = '#1a1f29';
  context.font = 'bold 48px monospace';
  context.fillText('RECEIPT', 290, 120);
  context.font = '30px monospace';
  const lines = ['Coffee beans    18.50', 'Filter papers    4.20', 'Milk             2.10', '', 'TOTAL           24.80'];
  lines.forEach((line, i) => context.fillText(line, 120, 260 + i * 60));
  context.fillRect(120, 640, 560, 3);

  // Rotate 90° anticlockwise into a landscape buffer; orientation 6 turns it back upright.
  const stored = canvas2d(1200, 800);
  stored.context.translate(0, 800);
  stored.context.rotate(-Math.PI / 2);
  stored.context.drawImage(upright.canvas, 0, 0);
  return withExifOrientation(await bytesOf(stored.canvas, 'image/jpeg', 0.9), 6);
}

export async function handleImageToPdfRequest(request: ImageToPdfWorkerRequest, codec: ImageDecodeCodec = browserImageCodec): Promise<ImageToPdfWorkerResult> {
  if (request.kind === 'samples') {
    return {
      kind: 'samples',
      files: [
        { name: '01-landscape-photo.jpg', type: 'image/jpeg', bytes: await samplePhotoJpeg(1600, 1067) },
        { name: '02-sales-chart.png', type: 'image/png', bytes: await sampleChartPng() },
        { name: '03-receipt-phone-photo.jpg', type: 'image/jpeg', bytes: await sampleReceiptJpeg() },
      ],
    };
  }
  const result = await imagesToPdf(request.sources, request.options, codec);
  return result.ok ? { kind: 'build', ok: true, output: result.value } : { kind: 'build', ok: false, error: result.error };
}

declare const self: WorkerScope<ImageToPdfWorkerRequest, ImageToPdfWorkerResult>;
listenForRequests(self, (request) => handleImageToPdfRequest(request));
