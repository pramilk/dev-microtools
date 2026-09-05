import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildFaceDetectorInput,
  nonMaxSuppression,
  decodeFaceDetections,
  expandBox,
  clampRegionToImage,
  moveRegion,
  resizeRegionBy,
  createManualRegion,
  applyBoxBlur,
  applyPixelate,
  applyBlackBox,
  applyRedactions,
  MIN_REGION_SIZE,
  type DetectedBox,
  type RedactRegion,
  type RgbaImageData,
} from './imageRedact';

function solidImage(width: number, height: number, r: number, g: number, b: number, a = 255): RgbaImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width, height };
}

function pixelAt(image: RgbaImageData, x: number, y: number): [number, number, number, number] {
  const idx = (y * image.width + x) * 4;
  return [image.data[idx]!, image.data[idx + 1]!, image.data[idx + 2]!, image.data[idx + 3]!];
}

describe('buildFaceDetectorInput', () => {
  it('normalizes each channel by (value - 127) / 128, laid out as CHW', () => {
    // A single 1x1 pixel: R=255, G=127, B=0.
    const rgba = new Uint8ClampedArray([255, 127, 0, 255]);
    const tensor = buildFaceDetectorInput(rgba, 1, 1);

    expect(tensor.length).toBe(3);
    expect(tensor[0]).toBeCloseTo((255 - 127) / 128, 10);
    expect(tensor[1]).toBeCloseTo(0, 10);
    expect(tensor[2]).toBeCloseTo((0 - 127) / 128, 10);
  });

  it('lays out multiple pixels as separate R/G/B planes, not interleaved', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const tensor = buildFaceDetectorInput(rgba, 2, 1);
    expect(tensor.length).toBe(6);
    // R plane first (both pixels), then G plane, then B plane.
    expect(tensor[0]).toBeCloseTo((10 - 127) / 128, 10);
    expect(tensor[1]).toBeCloseTo((40 - 127) / 128, 10);
    expect(tensor[2]).toBeCloseTo((20 - 127) / 128, 10);
    expect(tensor[3]).toBeCloseTo((50 - 127) / 128, 10);
  });
});

describe('nonMaxSuppression', () => {
  it('keeps the highest-scoring box and discards a heavily overlapping lower-scoring one', () => {
    const boxes: DetectedBox[] = [
      { x0: 0, y0: 0, x1: 10, y1: 10, score: 0.9 },
      { x0: 1, y0: 1, x1: 11, y1: 11, score: 0.8 },
    ];
    const kept = nonMaxSuppression(boxes, 0.5);
    expect(kept).toEqual([boxes[0]]);
  });

  it('keeps two boxes that do not overlap', () => {
    const boxes: DetectedBox[] = [
      { x0: 0, y0: 0, x1: 10, y1: 10, score: 0.9 },
      { x0: 100, y0: 100, x1: 110, y1: 110, score: 0.8 },
    ];
    expect(nonMaxSuppression(boxes, 0.5)).toHaveLength(2);
  });

  it('returns an empty array for no input', () => {
    expect(nonMaxSuppression([], 0.5)).toEqual([]);
  });
});

describe('decodeFaceDetections', () => {
  it('filters out detections below the score threshold', () => {
    // Two priors: prior 0 has a high face score, prior 1 a low one.
    const scores = new Float32Array([0.1, 0.9, 0.9, 0.1]);
    const boxes = new Float32Array([0.1, 0.1, 0.5, 0.5, 0.6, 0.6, 0.9, 0.9]);
    const detections = decodeFaceDetections(scores, boxes, 100, 200, 0.7, 0.5);
    expect(detections).toHaveLength(1);
    expect(detections[0]!.x0).toBeCloseTo(10, 5);
    expect(detections[0]!.y0).toBeCloseTo(20, 5);
    expect(detections[0]!.x1).toBeCloseTo(50, 5);
    expect(detections[0]!.y1).toBeCloseTo(100, 5);
  });

  it('scales normalized boxes to the image pixel dimensions', () => {
    const scores = new Float32Array([0, 1]);
    const boxes = new Float32Array([0, 0, 1, 1]);
    const [box] = decodeFaceDetections(scores, boxes, 320, 240, 0.5, 0.5);
    expect(box).toMatchObject({ x0: 0, y0: 0, x1: 320, y1: 240 });
  });

  it('applies NMS across overlapping high-confidence priors', () => {
    const scores = new Float32Array([0, 0.95, 0, 0.9]);
    const boxes = new Float32Array([0.1, 0.1, 0.5, 0.5, 0.12, 0.12, 0.52, 0.52]);
    const detections = decodeFaceDetections(scores, boxes, 100, 100, 0.5, 0.5);
    expect(detections).toHaveLength(1);
    expect(detections[0]!.score).toBeCloseTo(0.95, 5);
  });

  it('returns nothing for an all-background output', () => {
    const scores = new Float32Array([1, 0, 1, 0]);
    const boxes = new Float32Array([0.1, 0.1, 0.5, 0.5, 0.6, 0.6, 0.9, 0.9]);
    expect(decodeFaceDetections(scores, boxes, 100, 100)).toEqual([]);
  });
});

describe('expandBox', () => {
  it('pads a box outward by the given ratio of its own size', () => {
    const box: DetectedBox = { x0: 20, y0: 20, x1: 40, y1: 60, score: 0.9 };
    const expanded = expandBox(box, 0.5, 1000, 1000);
    // width=20, height=40 -> pad by 10 horizontally, 20 vertically.
    expect(expanded).toMatchObject({ x0: 10, y0: 0, x1: 50, y1: 80 });
  });

  it('clamps padding at the image bounds instead of going negative or past the edge', () => {
    const box: DetectedBox = { x0: 2, y0: 2, x1: 12, y1: 12, score: 0.9 };
    const expanded = expandBox(box, 1, 20, 20);
    expect(expanded.x0).toBe(0);
    expect(expanded.y0).toBe(0);
    expect(expanded.x1).toBeLessThanOrEqual(20);
    expect(expanded.y1).toBeLessThanOrEqual(20);
  });
});

describe('clampRegionToImage', () => {
  const region = (over: Partial<RedactRegion>): RedactRegion => ({
    id: 'r1',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    source: 'manual',
    style: 'blur',
    shape: 'rect',
    intensity: 16,
    ...over,
  });

  it('leaves an in-bounds region unchanged', () => {
    expect(clampRegionToImage(region({ x: 5, y: 5, width: 20, height: 20 }), 100, 100)).toEqual(
      region({ x: 5, y: 5, width: 20, height: 20 })
    );
  });

  it('clamps a region that overflows the image edge', () => {
    const result = clampRegionToImage(region({ x: 90, y: 90, width: 30, height: 30 }), 100, 100);
    expect(result.x + result.width).toBeLessThanOrEqual(100);
    expect(result.y + result.height).toBeLessThanOrEqual(100);
  });

  it('never shrinks below MIN_REGION_SIZE even when requested smaller', () => {
    const result = clampRegionToImage(region({ width: 1, height: 1 }), 100, 100);
    expect(result.width).toBe(MIN_REGION_SIZE);
    expect(result.height).toBe(MIN_REGION_SIZE);
  });

  it('handles a region requested entirely outside the image', () => {
    const result = clampRegionToImage(region({ x: 500, y: 500, width: 10, height: 10 }), 100, 100);
    expect(result.x).toBeLessThanOrEqual(100 - MIN_REGION_SIZE);
    expect(result.y).toBeLessThanOrEqual(100 - MIN_REGION_SIZE);
  });
});

describe('moveRegion', () => {
  it('translates a region by the given delta', () => {
    const region: RedactRegion = { id: 'r', x: 10, y: 10, width: 20, height: 20, source: 'manual', style: 'blur', intensity: 16, shape: 'rect' };
    expect(moveRegion(region, 5, -5, 200, 200)).toMatchObject({ x: 15, y: 5, width: 20, height: 20 });
  });

  it('stops at the image edge without resizing the region', () => {
    const region: RedactRegion = { id: 'r', x: 10, y: 10, width: 20, height: 20, source: 'manual', style: 'blur', intensity: 16, shape: 'rect' };
    const result = moveRegion(region, 1000, 1000, 100, 100);
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
    expect(result.x + result.width).toBeLessThanOrEqual(100);
    expect(result.y + result.height).toBeLessThanOrEqual(100);
  });
});

describe('resizeRegionBy', () => {
  it('grows a region by the given delta', () => {
    const region: RedactRegion = { id: 'r', x: 10, y: 10, width: 20, height: 20, source: 'manual', style: 'blur', intensity: 16, shape: 'rect' };
    expect(resizeRegionBy(region, 10, 5, 200, 200)).toMatchObject({ width: 30, height: 25 });
  });

  it('never shrinks a region below MIN_REGION_SIZE', () => {
    const region: RedactRegion = { id: 'r', x: 10, y: 10, width: 20, height: 20, source: 'manual', style: 'blur', intensity: 16, shape: 'rect' };
    const result = resizeRegionBy(region, -1000, -1000, 200, 200);
    expect(result.width).toBe(MIN_REGION_SIZE);
    expect(result.height).toBe(MIN_REGION_SIZE);
  });
});

describe('createManualRegion', () => {
  it('creates a region centered within the image and inside its bounds', () => {
    const region = createManualRegion(1000, 500);
    expect(region.source).toBe('manual');
    expect(region.x).toBeGreaterThanOrEqual(0);
    expect(region.y).toBeGreaterThanOrEqual(0);
    expect(region.x + region.width).toBeLessThanOrEqual(1000);
    expect(region.y + region.height).toBeLessThanOrEqual(500);
  });

  it('gives each region a distinct id', () => {
    const a = createManualRegion(500, 500);
    const b = createManualRegion(500, 500);
    expect(a.id).not.toBe(b.id);
  });
});

describe('applyBlackBox', () => {
  it('fills only the requested rect with black, leaving the rest of the image untouched', () => {
    const image = solidImage(4, 4, 200, 150, 100);
    const result = applyBlackBox(image, { x: 1, y: 1, width: 2, height: 2 });

    expect(pixelAt(result, 1, 1)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(result, 2, 2)).toEqual([0, 0, 0, 255]);
    // Outside the rect, untouched.
    expect(pixelAt(result, 0, 0)).toEqual([200, 150, 100, 255]);
    expect(pixelAt(result, 3, 3)).toEqual([200, 150, 100, 255]);
  });

  it('does not mutate the source image', () => {
    const image = solidImage(4, 4, 200, 150, 100);
    applyBlackBox(image, { x: 0, y: 0, width: 2, height: 2 });
    expect(pixelAt(image, 0, 0)).toEqual([200, 150, 100, 255]);
  });

  it('handles a rect that extends past the image bounds without throwing', () => {
    const image = solidImage(4, 4, 200, 150, 100);
    expect(() => applyBlackBox(image, { x: 2, y: 2, width: 100, height: 100 })).not.toThrow();
  });

  it('with shape "ellipse", leaves the rect\'s own corners untouched', () => {
    // A 10x10 rect: its corners sit outside the inscribed circle/ellipse, its center well
    // inside it.
    const image = solidImage(10, 10, 200, 150, 100);
    const result = applyBlackBox(image, { x: 0, y: 0, width: 10, height: 10 }, 'ellipse');
    expect(pixelAt(result, 0, 0)).toEqual([200, 150, 100, 255]);
    expect(pixelAt(result, 9, 0)).toEqual([200, 150, 100, 255]);
    expect(pixelAt(result, 0, 9)).toEqual([200, 150, 100, 255]);
    expect(pixelAt(result, 9, 9)).toEqual([200, 150, 100, 255]);
    expect(pixelAt(result, 5, 5)).toEqual([0, 0, 0, 255]);
  });

  it('with shape "rect" (the default), does redact the corners', () => {
    const image = solidImage(10, 10, 200, 150, 100);
    const result = applyBlackBox(image, { x: 0, y: 0, width: 10, height: 10 });
    expect(pixelAt(result, 0, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe('applyPixelate', () => {
  it('averages each block, producing a single flat color per block', () => {
    // 2x2 image, one 2x2 block: values average to (0+10+20+30)/4 etc per channel.
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, //
      20, 20, 20, 255, //
      40, 40, 40, 255, //
      60, 40, 40, 255, //
    ]);
    const image: RgbaImageData = { data, width: 2, height: 2 };
    const result = applyPixelate(image, { x: 0, y: 0, width: 2, height: 2 }, 2);
    const expectedR = Math.round((0 + 20 + 40 + 60) / 4);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        expect(pixelAt(result, x, y)[0]).toBe(expectedR);
      }
    }
  });

  it('leaves pixels outside the rect untouched', () => {
    const image = solidImage(4, 4, 10, 20, 30);
    const result = applyPixelate(image, { x: 0, y: 0, width: 2, height: 2 }, 2);
    expect(pixelAt(result, 3, 3)).toEqual([10, 20, 30, 255]);
  });
});

describe('applyBoxBlur', () => {
  it('preserves image dimensions', () => {
    const image = solidImage(10, 10, 100, 100, 100);
    const result = applyBoxBlur(image, { x: 2, y: 2, width: 4, height: 4 }, 2);
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
  });

  it('leaves pixels far outside the blurred rect untouched', () => {
    const data = new Uint8ClampedArray(20 * 20 * 4);
    for (let i = 0; i < 20 * 20; i++) {
      data[i * 4] = i % 2 === 0 ? 255 : 0;
      data[i * 4 + 3] = 255;
    }
    const image: RgbaImageData = { data, width: 20, height: 20 };
    const result = applyBoxBlur(image, { x: 0, y: 0, width: 4, height: 4 }, 1);
    // Far corner, well outside the blurred rect and its padding window.
    expect(pixelAt(result, 19, 19)).toEqual(pixelAt(image, 19, 19));
  });

  it('smooths a hard edge inside the blurred region rather than leaving it untouched', () => {
    const size = 12;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const value = x < size / 2 ? 0 : 255;
        data[idx] = value;
        data[idx + 1] = value;
        data[idx + 2] = value;
        data[idx + 3] = 255;
      }
    }
    const image: RgbaImageData = { data, width: size, height: size };
    const result = applyBoxBlur(image, { x: 0, y: 0, width: size, height: size }, 3);
    // Right at the old hard edge, blurring should produce an intermediate gray, not a
    // still-pure 0 or 255.
    const midValue = pixelAt(result, size / 2 - 1, size / 2)[0]!;
    expect(midValue).toBeGreaterThan(10);
    expect(midValue).toBeLessThan(245);
  });

  it('does not mutate the source image', () => {
    const image = solidImage(10, 10, 50, 60, 70);
    applyBoxBlur(image, { x: 0, y: 0, width: 5, height: 5 }, 2);
    expect(pixelAt(image, 2, 2)).toEqual([50, 60, 70, 255]);
  });

  it('handles a degenerate (zero-size) rect without throwing', () => {
    const image = solidImage(5, 5, 1, 2, 3);
    expect(() => applyBoxBlur(image, { x: 10, y: 10, width: 0, height: 0 }, 2)).not.toThrow();
  });
});

describe('applyRedactions', () => {
  it('applies each region\'s own style in one pass', () => {
    const image = solidImage(10, 10, 200, 200, 200);
    const regions: RedactRegion[] = [
      { id: 'a', x: 0, y: 0, width: 2, height: 2, source: 'auto', style: 'blackbox', intensity: 0, shape: 'rect' },
      { id: 'b', x: 6, y: 6, width: 2, height: 2, source: 'manual', style: 'blackbox', intensity: 0, shape: 'rect' },
    ];
    const result = applyRedactions(image, regions);
    expect(pixelAt(result, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(result, 6, 6)).toEqual([0, 0, 0, 255]);
    // Untouched area between the two regions.
    expect(pixelAt(result, 4, 4)).toEqual([200, 200, 200, 255]);
  });

  it('lets one region stay blurred while another is a solid box', () => {
    const image = solidImage(20, 20, 10, 20, 30);
    const regions: RedactRegion[] = [
      { id: 'a', x: 0, y: 0, width: 6, height: 6, source: 'auto', style: 'blur', intensity: 2, shape: 'rect' },
      { id: 'b', x: 12, y: 12, width: 6, height: 6, source: 'manual', style: 'blackbox', intensity: 0, shape: 'rect' },
    ];
    const result = applyRedactions(image, regions);
    // The blur region keeps the same flat color (nothing to blend into on a solid image)
    // but the blackbox region turns fully black — proving each region's own style applied.
    expect(pixelAt(result, 3, 3)).toEqual([10, 20, 30, 255]);
    expect(pixelAt(result, 15, 15)).toEqual([0, 0, 0, 255]);
  });

  it('is a no-op for an empty region list', () => {
    const image = solidImage(4, 4, 1, 2, 3);
    const result = applyRedactions(image, []);
    expect(Array.from(result.data)).toEqual(Array.from(image.data));
  });
});

// detectFaceRegions drives real onnxruntime-web, which needs actual WebAssembly support
// this test environment doesn't provide — stood in with a fake session, the same boundary
// backgroundRemove.test.ts draws around removeBackgroundFromImage.
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

describe('detectFaceRegions', () => {
  beforeEach(() => {
    runMock.mockReset();
    createMock.mockReset();
    tensorMock.mockClear();
    // Same module-scope caching concern as backgroundRemove.test.ts: force a fresh module
    // instance per test so a failed session from one test can't leak into the next.
    vi.resetModules();
  });

  it('returns an expanded, auto-sourced region for each detected face', async () => {
    createMock.mockResolvedValue({
      inputNames: ['input'],
      run: runMock,
    });
    // One confident face prior, normalized corner-form box in the middle of the frame.
    runMock.mockResolvedValue({
      scores: { data: new Float32Array([0, 0.95]), dims: [1, 1, 2] },
      boxes: { data: new Float32Array([0.4, 0.4, 0.6, 0.6]), dims: [1, 1, 4] },
    });

    const { detectFaceRegions } = await import('./imageRedact');
    const image = solidImage(200, 200, 10, 10, 10);
    const regions = await detectFaceRegions(image);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.source).toBe('auto');
    // Raw box would be [80,80]-[120,120]; the 30% margin expands it outward.
    expect(regions[0]!.x).toBeLessThan(80);
    expect(regions[0]!.y).toBeLessThan(80);
    expect(regions[0]!.width).toBeGreaterThan(40);
  });

  it('returns an empty array when nothing scores above the threshold', async () => {
    createMock.mockResolvedValue({ inputNames: ['input'], run: runMock });
    runMock.mockResolvedValue({
      scores: { data: new Float32Array([1, 0]), dims: [1, 1, 2] },
      boxes: { data: new Float32Array([0.4, 0.4, 0.6, 0.6]), dims: [1, 1, 4] },
    });

    const { detectFaceRegions } = await import('./imageRedact');
    const regions = await detectFaceRegions(solidImage(100, 100, 1, 1, 1));
    expect(regions).toEqual([]);
  });

  it('wraps a failed model load in a descriptive error and allows a retry to load fresh', async () => {
    createMock.mockRejectedValueOnce(new Error('network down'));
    const { detectFaceRegions } = await import('./imageRedact');
    const image = solidImage(50, 50, 1, 1, 1);

    await expect(detectFaceRegions(image)).rejects.toThrow(/could not load/i);

    createMock.mockResolvedValue({ inputNames: ['input'], run: runMock });
    runMock.mockResolvedValue({
      scores: { data: new Float32Array([1, 0]), dims: [1, 1, 2] },
      boxes: { data: new Float32Array([0, 0, 0.1, 0.1]), dims: [1, 1, 4] },
    });
    await expect(detectFaceRegions(image)).resolves.toEqual([]);
  });
});
