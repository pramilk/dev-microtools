import { describe, it, expect } from 'vitest';
import { decodeQrFromPixels, fitWithin, NO_QR_FOUND_MESSAGE, type Pixels } from './qrDecode';
import { generateQrMatrix, type QrMatrix } from './qrcode';

async function asciiMatrix(text: string): Promise<QrMatrix> {
  const result = await generateQrMatrix(text);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** Builds the code with explicit UTF-8 byte encoding, which is what phone scanners expect. */
async function utf8Matrix(text: string): Promise<QrMatrix> {
  const loaded = (await import('qrcode-generator')) as unknown as {
    default: typeof import('qrcode-generator');
  };
  const factory = loaded.default;
  factory.stringToBytes = (value: string) => Array.from(new TextEncoder().encode(value));
  const qr = factory(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  return { moduleCount: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) };
}

/** Renders text to an RGBA buffer the way a screenshot of the QR code would look. */
async function renderQr(text: string, scale = 6, quiet = 4, invert = false, utf8 = false): Promise<Pixels> {
  const matrix = utf8 ? await utf8Matrix(text) : await asciiMatrix(text);
  const modules = matrix.moduleCount + quiet * 2;
  const size = modules * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const row = Math.floor(y / scale) - quiet;
      const col = Math.floor(x / scale) - quiet;
      const inside = row >= 0 && col >= 0 && row < matrix.moduleCount && col < matrix.moduleCount;
      const dark = inside && matrix.isDark(row, col);
      const value = dark !== invert ? 0 : 255;
      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

describe('decodeQrFromPixels', () => {
  it('round-trips a URL', async () => {
    const result = await decodeQrFromPixels(await renderQr('https://example.com/menu?table=4'));
    expect(result).toEqual({ ok: true, value: 'https://example.com/menu?table=4' });
  });

  it('round-trips Unicode text', async () => {
    const result = await decodeQrFromPixels(await renderQr('Café ☕ 日本語', 6, 4, false, true));
    expect(result).toEqual({ ok: true, value: 'Café ☕ 日本語' });
  });

  it('reads a light-on-dark (inverted) code', async () => {
    const result = await decodeQrFromPixels(await renderQr('https://example.com', 6, 4, true));
    expect(result).toEqual({ ok: true, value: 'https://example.com' });
  });

  it('reads a long payload', async () => {
    const long = `https://example.com/?q=${'a'.repeat(900)}`;
    const result = await decodeQrFromPixels(await renderQr(long, 4));
    expect(result).toEqual({ ok: true, value: long });
  });

  it('reports a clear error when the image has no QR code', async () => {
    const size = 200;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    const result = await decodeQrFromPixels({ data, width: size, height: size });
    expect(result).toEqual({ ok: false, error: NO_QR_FOUND_MESSAGE });
  });

  it('rejects an image too small to hold a QR code', async () => {
    const result = await decodeQrFromPixels({ data: new Uint8ClampedArray(10 * 10 * 4), width: 10, height: 10 });
    expect(result.ok).toBe(false);
  });

  it('rejects a buffer whose length does not match its dimensions', async () => {
    const result = await decodeQrFromPixels({ data: new Uint8ClampedArray(40), width: 100, height: 100 });
    expect(result.ok).toBe(false);
  });

  it('rejects empty input', async () => {
    const result = await decodeQrFromPixels({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
    expect(result.ok).toBe(false);
  });
});

describe('fitWithin', () => {
  it('leaves a small image alone', () => {
    expect(fitWithin(300, 200, 1000)).toEqual({ width: 300, height: 200 });
  });

  it('scales the longest side down, keeping the aspect ratio', () => {
    expect(fitWithin(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitWithin(2000, 4000, 1000)).toEqual({ width: 500, height: 1000 });
  });

  it('never returns a zero dimension', () => {
    expect(fitWithin(100000, 10, 100).height).toBeGreaterThanOrEqual(1);
  });
});
