import { describe, it, expect } from 'vitest';
import { handleSvgOptimizeRequest } from './svgOptimize.worker';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5.000000" cy="5" r="4" /></svg>';

describe('handleSvgOptimizeRequest', () => {
  it('optimizes valid SVG markup', async () => {
    const output = await handleSvgOptimizeRequest({ input: SVG, options: {} });
    expect(output).toContain('<svg');
    expect(output.length).toBeLessThan(SVG.length);
  });

  it('rejects with the underlying tool error for non-SVG markup', async () => {
    await expect(handleSvgOptimizeRequest({ input: '<div></div>', options: {} })).rejects.toThrow(/svg/i);
  });
});
