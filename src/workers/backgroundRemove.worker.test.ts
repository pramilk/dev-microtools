import { describe, it, expect, vi } from 'vitest';
import { MODEL_INPUT_SIZE } from '../lib/tools/backgroundRemove';

const { runMock, createMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  createMock: vi.fn(),
}));
vi.mock('onnxruntime-web/wasm', () => ({
  env: { wasm: {} as Record<string, unknown> },
  InferenceSession: { create: createMock },
  Tensor: vi.fn(function (type: string, data: unknown, dims: number[]) {
    return { type, data, dims };
  }),
}));

describe('handleBackgroundRemoveRequest', () => {
  it('runs background removal and returns an RGBA buffer of the same dimensions', async () => {
    const size = MODEL_INPUT_SIZE;
    createMock.mockResolvedValue({ inputNames: ['input'], outputNames: ['output'], run: runMock });
    runMock.mockResolvedValue({ output: { data: new Float32Array(size * size).fill(0.5) } });

    const { handleBackgroundRemoveRequest } = await import('./backgroundRemove.worker');
    const width = 3;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4).fill(200);

    const result = await handleBackgroundRemoveRequest({ image: { data, width, height } });

    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
    expect(result.data.length).toBe(width * height * 4);
  });
});
