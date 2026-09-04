import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resizeBilinear,
  buildInputTensor,
  maskFromModelOutput,
  applyAlphaMask,
  rotatePoint,
  defaultPlacement,
  computeLinearGradientLine,
  MODEL_INPUT_SIZE,
} from './backgroundRemove';

describe('computeLinearGradientLine', () => {
  it('runs left-to-right at 0 degrees, centered vertically', () => {
    const line = computeLinearGradientLine(100, 50, 0);
    const halfDiagonal = Math.sqrt(100 ** 2 + 50 ** 2) / 2;
    expect(line.y0).toBeCloseTo(25, 10);
    expect(line.y1).toBeCloseTo(25, 10);
    expect(line.x0).toBeCloseTo(50 - halfDiagonal, 10);
    expect(line.x1).toBeCloseTo(50 + halfDiagonal, 10);
  });

  it('runs top-to-bottom at 90 degrees, centered horizontally', () => {
    const line = computeLinearGradientLine(100, 50, 90);
    expect(line.x0).toBeCloseTo(50, 10);
    expect(line.x1).toBeCloseTo(50, 10);
    expect(line.y1).toBeGreaterThan(line.y0);
  });

  it('is always centered on the canvas regardless of angle', () => {
    const line = computeLinearGradientLine(200, 80, 37);
    expect((line.x0 + line.x1) / 2).toBeCloseTo(100, 10);
    expect((line.y0 + line.y1) / 2).toBeCloseTo(40, 10);
  });

  it('reaches the full diagonal length so an angled gradient still covers every corner', () => {
    const line = computeLinearGradientLine(100, 50, 45);
    const length = Math.sqrt((line.x1 - line.x0) ** 2 + (line.y1 - line.y0) ** 2);
    expect(length).toBeCloseTo(Math.sqrt(100 ** 2 + 50 ** 2), 10);
  });
});

describe('rotatePoint', () => {
  it('leaves a point unchanged at zero rotation', () => {
    const result = rotatePoint(10, 0, 0, 0, 0);
    expect(result.x).toBeCloseTo(10, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  it('rotates a point 90 degrees clockwise around the origin', () => {
    // Standard screen coordinates (Y grows downward): rotating (10, 0) by +90° clockwise
    // lands it at (0, 10), matching CSS transform: rotate(90deg) and canvas ctx.rotate().
    const result = rotatePoint(10, 0, 0, 0, 90);
    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(10, 10);
  });

  it('rotates around an arbitrary pivot, not just the origin', () => {
    const result = rotatePoint(15, 5, 5, 5, 90);
    expect(result.x).toBeCloseTo(5, 10);
    expect(result.y).toBeCloseTo(15, 10);
  });

  it('returns to the exact starting point after a full 360 degree turn', () => {
    const result = rotatePoint(12, 34, 5, 6, 360);
    expect(result.x).toBeCloseTo(12, 8);
    expect(result.y).toBeCloseTo(34, 8);
  });
});

describe('defaultPlacement', () => {
  it('centers the cutout on the canvas with no rotation', () => {
    const placement = defaultPlacement(100, 100, 400, 300);
    expect(placement.x).toBe(200);
    expect(placement.y).toBe(150);
    expect(placement.rotation).toBe(0);
  });

  it('contain-fits a wider-than-canvas cutout down with a margin, height-limited', () => {
    // 400x400 cutout into a 200x100 canvas: height is the binding constraint (100/400 = 0.25),
    // then a 10% margin on top of that.
    const placement = defaultPlacement(400, 400, 200, 100);
    expect(placement.scale).toBeCloseTo(0.25 * 0.9, 10);
  });

  it('contain-fits a wider-than-tall cutout down with a margin, width-limited', () => {
    // 400x100 cutout into a 200x100 canvas: width is the binding constraint (200/400 = 0.5).
    const placement = defaultPlacement(400, 100, 200, 100);
    expect(placement.scale).toBeCloseTo(0.5 * 0.9, 10);
  });

  it('falls back to a centered, unscaled placement for a degenerate (zero-size) cutout', () => {
    expect(defaultPlacement(0, 0, 200, 100)).toEqual({ x: 100, y: 50, scale: 1, rotation: 0 });
  });
});

describe('resizeBilinear', () => {
  it('leaves a same-size image unchanged', () => {
    const src = new Uint8ClampedArray([10, 20, 30, 40]);
    expect(Array.from(resizeBilinear(src, 2, 2, 2, 2, 1))).toEqual([10, 20, 30, 40]);
  });

  it('bilinearly blends four source pixels into one when downsampling 2x2 to 1x1', () => {
    // row0: 10 20 · row1: 30 40 — sampled at the exact center, so all four weigh equally.
    const src = new Uint8ClampedArray([10, 20, 30, 40]);
    expect(Array.from(resizeBilinear(src, 2, 2, 1, 1, 1))).toEqual([25]);
  });

  it('replicates a single source pixel when upsampling 1x1 to 2x2', () => {
    const src = new Uint8ClampedArray([42]);
    expect(Array.from(resizeBilinear(src, 1, 1, 2, 2, 1))).toEqual([42, 42, 42, 42]);
  });

  it('resamples every channel independently for multi-channel (RGBA) buffers', () => {
    // Two 1x1-equivalent pixels stacked so each channel has its own distinct constant value.
    const src = new Uint8ClampedArray([10, 20, 30, 40, 10, 20, 30, 40]);
    expect(Array.from(resizeBilinear(src, 1, 2, 1, 1, 4))).toEqual([10, 20, 30, 40]);
  });
});

describe('buildInputTensor', () => {
  it('normalizes a single pixel by its own max channel value, then by ImageNet mean/std, laid out as CHW', () => {
    // R=200 (the max), G=100, B=50, alpha ignored.
    const rgba = new Uint8ClampedArray([200, 100, 50, 255]);
    const tensor = buildInputTensor(rgba, 1);

    expect(tensor.length).toBe(3);
    expect(tensor[0]).toBeCloseTo((200 / 200 - 0.485) / 0.229, 5);
    expect(tensor[1]).toBeCloseTo((100 / 200 - 0.456) / 0.224, 5);
    expect(tensor[2]).toBeCloseTo((50 / 200 - 0.406) / 0.225, 5);
  });

  it('never divides by zero for a fully black image', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255]);
    const tensor = buildInputTensor(rgba, 1);
    expect(tensor.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('maskFromModelOutput', () => {
  it('min-max stretches the output range to a 0-255 mask', () => {
    const output = new Float32Array([0, 1, 2, 3]);
    expect(Array.from(maskFromModelOutput(output, 2))).toEqual([0, 85, 170, 255]);
  });

  it('never divides by zero for a perfectly flat output', () => {
    const output = new Float32Array([5, 5, 5, 5]);
    const mask = maskFromModelOutput(output, 2);
    expect(Array.from(mask).every((v) => Number.isFinite(v))).toBe(true);
  });

  it('reads only the first size*size values when the model reports extra channels', () => {
    // size=1 -> only the first value (0) matters; a second "channel" value (99) must not
    // skew the min/max the single pixel is stretched against.
    const output = new Float32Array([0, 99]);
    expect(Array.from(maskFromModelOutput(output, 1))).toEqual([0]);
  });

  it('throws instead of silently reading out of bounds when the output is too short', () => {
    expect(() => maskFromModelOutput(new Float32Array([1, 2]), 2)).toThrow(/unexpected output shape/i);
  });
});

describe('applyAlphaMask', () => {
  it('replaces only the alpha channel, leaving RGB untouched', () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    const mask = new Uint8ClampedArray([10, 20]);
    expect(Array.from(applyAlphaMask(rgba, mask))).toEqual([1, 2, 3, 10, 4, 5, 6, 20]);
  });
});

// removeBackgroundFromImage drives real onnxruntime-web, which needs actual WebAssembly
// support this test environment doesn't provide — stood in with a fake session whose `run`
// returns a canned, deliberately non-uniform output tensor, so the test exercises this
// module's own pre/post-processing pipeline (resize -> tensor -> mask -> resize -> composite)
// without needing a real model or WASM runtime, the same boundary
// imageCompress.worker.test.ts draws around @jsquash/oxipng.
const { runMock, createMock, tensorMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  createMock: vi.fn(),
  tensorMock: vi.fn(function (type: string, data: unknown, dims: number[]) {
    return { type, data, dims };
  }),
}));
vi.mock('onnxruntime-web/wasm', () => ({
  env: { wasm: {} as Record<string, unknown> },
  InferenceSession: { create: createMock },
  Tensor: tensorMock,
}));

describe('removeBackgroundFromImage', () => {
  beforeEach(() => {
    runMock.mockReset();
    createMock.mockReset();
    tensorMock.mockClear();
    // The module caches its loaded WASM runtime and inference session at module scope (by
    // design — reusing them across images in the same page visit is the whole point). That
    // means each test needs a fresh module instance, not just fresh mocks, or a later test
    // would silently reuse an earlier test's cached (possibly failed) session.
    vi.resetModules();
  });

  it('resizes the model output mask back to the source image and composites it as alpha', async () => {
    const size = MODEL_INPUT_SIZE;
    // A hard top/bottom step in the model's output space: rows above the midline saliency-map
    // to 0, rows below to 1 — after resizing back down to a small image, the top row should
    // end up nearly transparent and the bottom row nearly opaque.
    const output = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) output[y * size + x] = y < size / 2 ? 0 : 1;
    }

    createMock.mockResolvedValue({
      inputNames: ['input'],
      outputNames: ['output'],
      run: runMock,
    });
    runMock.mockResolvedValue({ output: { data: output } });

    const { removeBackgroundFromImage } = await import('./backgroundRemove');
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = 128;
      data[i * 4 + 1] = 128;
      data[i * 4 + 2] = 128;
      data[i * 4 + 3] = 255;
    }

    const result = await removeBackgroundFromImage({ data, width, height });

    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
    // Top-left pixel (row 0) sampled from the near-0 half of the mask.
    expect(result.data[3]).toBeLessThan(50);
    // Bottom-left pixel (row 3) sampled from the near-1 half of the mask.
    expect(result.data[(3 * width) * 4 + 3]).toBeGreaterThan(200);
    // RGB is untouched by the mask.
    expect(result.data[0]).toBe(128);
    expect(result.data[1]).toBe(128);
    expect(result.data[2]).toBe(128);
  });

  it('wraps a failed model load in a descriptive error and allows a retry to load fresh', async () => {
    createMock.mockRejectedValueOnce(new Error('network down'));
    const { removeBackgroundFromImage } = await import('./backgroundRemove');
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(255);

    await expect(removeBackgroundFromImage({ data, width: 2, height: 2 })).rejects.toThrow(/could not load/i);

    // A second attempt should try loading again rather than reusing the failed promise.
    createMock.mockResolvedValue({ inputNames: ['input'], outputNames: ['output'], run: runMock });
    runMock.mockResolvedValue({ output: { data: new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE).fill(1) } });
    await expect(removeBackgroundFromImage({ data, width: 2, height: 2 })).resolves.toBeTruthy();
  });
});
