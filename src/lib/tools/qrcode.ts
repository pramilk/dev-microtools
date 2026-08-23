import { type ToolResult, ok, err, messageFrom } from './result';

export const QR_ERROR_CORRECTION_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type QrErrorCorrectionLevel = (typeof QR_ERROR_CORRECTION_LEVELS)[number];

export interface QrMatrix {
  moduleCount: number;
  isDark: (row: number, col: number) => boolean;
}

/**
 * The library's maximum QR version (40) tops out around 2953 bytes at the lowest error
 * correction level. This cap sits comfortably under that regardless of encoding mode or
 * multi-byte UTF-8 expansion, and produces a clear error before the library's own.
 */
export const MAX_QR_TEXT_LENGTH = 1500;

/**
 * Builds a QR code as a boolean matrix — dark/light per module — rather than rendering
 * an image directly, so the island can draw it as SVG (crisp at any size, easy to theme
 * for dark mode, and trivial to export as either SVG or PNG).
 */
export async function generateQrMatrix(
  text: string,
  errorCorrection: QrErrorCorrectionLevel = 'M'
): Promise<ToolResult<QrMatrix>> {
  if (text.length === 0) return err('Enter some text or a URL to generate a QR code.');
  if (text.length > MAX_QR_TEXT_LENGTH) {
    return err(`That text is too long for a QR code (limit ${MAX_QR_TEXT_LENGTH} characters).`);
  }

  // `qrcode-generator` is a CommonJS `export =` module; the bundler wraps it as
  // `{ default: QRCodeFactory }` at runtime for a dynamic `import()`, which the
  // DefinitelyTyped-style `export =` declaration doesn't reflect — hence the cast,
  // the same pattern `hash.ts` uses for `spark-md5`.
  type QrCodeFactory = typeof import('qrcode-generator');
  let createQrCode: QrCodeFactory;
  try {
    const loaded = (await import('qrcode-generator')) as unknown as { default: QrCodeFactory };
    createQrCode = loaded.default;
  } catch {
    return err('Could not load the QR code generator. Check your connection and reload the page.');
  }

  try {
    // Type number 0 asks the library to pick the smallest version that fits the data.
    const qr = createQrCode(0, errorCorrection);
    qr.addData(text);
    qr.make();
    const moduleCount = qr.getModuleCount();
    return ok({ moduleCount, isDark: (row: number, col: number) => qr.isDark(row, col) });
  } catch (error) {
    return err(messageFrom(error, 'Could not generate a QR code for that text.'));
  }
}

/** Renders a matrix as an inline SVG string — used for both preview and SVG download. */
export function matrixToSvg(matrix: QrMatrix, options: { cellSize?: number; darkColor?: string; lightColor?: string } = {}): string {
  const { cellSize = 8, darkColor = '#000000', lightColor = '#ffffff' } = options;
  const size = matrix.moduleCount * cellSize;

  let path = '';
  for (let row = 0; row < matrix.moduleCount; row += 1) {
    for (let col = 0; col < matrix.moduleCount; col += 1) {
      if (matrix.isDark(row, col)) {
        path += `M${col * cellSize},${row * cellSize}h${cellSize}v${cellSize}h-${cellSize}z`;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="${lightColor}"/>` +
    `<path d="${path}" fill="${darkColor}"/>` +
    `</svg>`
  );
}
