import { describe, it, expect } from 'vitest';
import { handleImageUpscaleRequest } from './imageUpscale.worker';

describe('handleImageUpscaleRequest', () => {
  it('resizes an RGBA buffer to the requested target dimensions', async () => {
    const width = 3;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4).fill(100);

    const result = await handleImageUpscaleRequest({ image: { data, width, height }, targetWidth: 12, targetHeight: 6 });

    expect(result.width).toBe(12);
    expect(result.height).toBe(6);
    expect(result.data.length).toBe(12 * 6 * 4);
  });
});
