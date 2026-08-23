import { describe, it, expect } from 'vitest';
import { generateQrMatrix, matrixToSvg, MAX_QR_TEXT_LENGTH } from './qrcode';

describe('generateQrMatrix', () => {
  it('rejects empty input', async () => {
    const result = await generateQrMatrix('');
    expect(result.ok).toBe(false);
  });

  it('rejects text over the length cap', async () => {
    const result = await generateQrMatrix('a'.repeat(MAX_QR_TEXT_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(String(MAX_QR_TEXT_LENGTH));
  });

  it('produces a valid QR module grid for short text', async () => {
    const result = await generateQrMatrix('https://devmicrotools.com', 'M');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Valid QR versions are 21, 25, 29, ... 177 modules (4 * version + 17).
    expect(result.value.moduleCount).toBeGreaterThanOrEqual(21);
    expect((result.value.moduleCount - 17) % 4).toBe(0);
  });

  it('reports dark/light for every module without throwing', async () => {
    const result = await generateQrMatrix('hello world', 'L');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let darkCount = 0;
    for (let row = 0; row < result.value.moduleCount; row += 1) {
      for (let col = 0; col < result.value.moduleCount; col += 1) {
        if (result.value.isDark(row, col)) darkCount += 1;
      }
    }
    // A real QR code is never all-light or all-dark — the finder patterns alone
    // guarantee a substantial mix.
    expect(darkCount).toBeGreaterThan(0);
    expect(darkCount).toBeLessThan(result.value.moduleCount * result.value.moduleCount);
  });

  it('produces a larger matrix for longer text at the same error correction level', async () => {
    const short = await generateQrMatrix('a', 'M');
    const long = await generateQrMatrix('a'.repeat(500), 'M');
    expect(short.ok && long.ok).toBe(true);
    if (short.ok && long.ok) {
      expect(long.value.moduleCount).toBeGreaterThan(short.value.moduleCount);
    }
  });

  it('produces a valid matrix at every error correction level', async () => {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      const result = await generateQrMatrix('test data', level);
      expect(result.ok).toBe(true);
    }
  });
});

describe('matrixToSvg', () => {
  const flatMatrix = { moduleCount: 3, isDark: (row: number, col: number) => (row + col) % 2 === 0 };

  it('renders a well-formed SVG string sized to the module count and cell size', () => {
    const svg = matrixToSvg(flatMatrix, { cellSize: 10 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="30"');
    expect(svg).toContain('height="30"');
    expect(svg).toContain('</svg>');
  });

  it('uses the default colours when none are given', () => {
    const svg = matrixToSvg(flatMatrix);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
  });

  it('honours custom dark and light colours', () => {
    const svg = matrixToSvg(flatMatrix, { darkColor: '#123456', lightColor: '#abcdef' });
    expect(svg).toContain('fill="#abcdef"');
    expect(svg).toContain('fill="#123456"');
  });

  it('draws one path command per dark module', () => {
    const allDark = { moduleCount: 2, isDark: () => true };
    const svg = matrixToSvg(allDark, { cellSize: 5 });
    const commandCount = (svg.match(/M\d/g) ?? []).length;
    expect(commandCount).toBe(4);
  });
});
