import { describe, expect, it } from 'vitest';
import {
  aspectRatioForPreset,
  clampCropPosition,
  clampCropRect,
  constrainRectToAspectRatio,
  resolveResizeDimensions,
} from './imageCrop';

describe('aspectRatioForPreset', () => {
  it('returns null for "free"', () => {
    expect(aspectRatioForPreset('free')).toBeNull();
  });

  it('returns the correct ratio for each fixed preset', () => {
    expect(aspectRatioForPreset('1:1')).toBe(1);
    expect(aspectRatioForPreset('4:3')).toBeCloseTo(4 / 3);
    expect(aspectRatioForPreset('16:9')).toBeCloseTo(16 / 9);
    expect(aspectRatioForPreset('3:2')).toBeCloseTo(3 / 2);
  });
});

describe('clampCropRect', () => {
  it('leaves an already-valid rect unchanged', () => {
    expect(clampCropRect({ x: 10, y: 20, width: 100, height: 50 }, 800, 600)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it('rounds fractional values to whole pixels', () => {
    expect(clampCropRect({ x: 10.4, y: 20.6, width: 99.5, height: 50.2 }, 800, 600)).toEqual({
      x: 10,
      y: 21,
      width: 100,
      height: 50,
    });
  });

  it('clamps a negative origin to zero', () => {
    expect(clampCropRect({ x: -50, y: -10, width: 100, height: 50 }, 800, 600)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });

  it('shrinks a rect that overflows the right/bottom edge', () => {
    expect(clampCropRect({ x: 750, y: 550, width: 200, height: 200 }, 800, 600)).toEqual({
      x: 750,
      y: 550,
      width: 50,
      height: 50,
    });
  });

  it('never produces a rect smaller than 1x1', () => {
    expect(clampCropRect({ x: 0, y: 0, width: 0, height: 0 }, 800, 600)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('clamps a rect entirely outside the image back onto it', () => {
    expect(clampCropRect({ x: 10000, y: 10000, width: 100, height: 100 }, 800, 600)).toEqual({
      x: 799,
      y: 599,
      width: 1,
      height: 1,
    });
  });
});

describe('clampCropPosition', () => {
  it('leaves an already-valid rect unchanged', () => {
    expect(clampCropPosition({ x: 10, y: 20, width: 100, height: 50 }, 800, 600)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it('repositions without shrinking when the rect is dragged past an edge', () => {
    expect(clampCropPosition({ x: 750, y: 20, width: 100, height: 50 }, 800, 600)).toEqual({
      x: 700,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it('repositions off a negative origin without shrinking', () => {
    expect(clampCropPosition({ x: -30, y: -30, width: 100, height: 50 }, 800, 600)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });

  it('shrinks a rect only when it is larger than the image itself', () => {
    expect(clampCropPosition({ x: 0, y: 0, width: 1000, height: 800 }, 800, 600)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });
});

describe('constrainRectToAspectRatio', () => {
  it('adjusts height to match a wider ratio when there is room', () => {
    const result = constrainRectToAspectRatio({ x: 0, y: 0, width: 400, height: 400 }, 16 / 9, 800, 600);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(400);
    expect(result.height).toBe(Math.round(400 / (16 / 9)));
  });

  it('shrinks the rect to fit when the image is too short for the requested ratio at full width', () => {
    // At (0, 500) only 100px of height remain in an 800x600 image; a 1:1 rect starting at
    // width 400 would need 400px of height, which doesn't fit.
    const result = constrainRectToAspectRatio({ x: 0, y: 500, width: 400, height: 400 }, 1, 800, 600);
    expect(result.height).toBeLessThanOrEqual(100);
    expect(result.width).toBeCloseTo(result.height, 0);
  });

  it('keeps the top-left corner fixed', () => {
    const result = constrainRectToAspectRatio({ x: 50, y: 60, width: 300, height: 200 }, 1, 800, 600);
    expect(result.x).toBe(50);
    expect(result.y).toBe(60);
  });

  it('produces a square for the 1:1 preset', () => {
    const result = constrainRectToAspectRatio({ x: 0, y: 0, width: 300, height: 150 }, 1, 800, 600);
    expect(result.width).toBe(result.height);
  });
});

describe('resolveResizeDimensions', () => {
  it('returns the crop size unchanged when no target is given', () => {
    expect(resolveResizeDimensions(400, 300, null, null, false)).toEqual({ width: 400, height: 300 });
  });

  it('uses both explicit dimensions when not locked, ignoring aspect ratio', () => {
    expect(resolveResizeDimensions(400, 300, 200, 500, false)).toEqual({ width: 200, height: 500 });
  });

  it('derives height from width when locked and only width is given', () => {
    expect(resolveResizeDimensions(400, 200, 200, null, true)).toEqual({ width: 200, height: 100 });
  });

  it('derives width from height when locked and only height is given', () => {
    expect(resolveResizeDimensions(400, 200, null, 50, true)).toEqual({ width: 100, height: 50 });
  });

  it('trusts both explicit dimensions when locked and both are given', () => {
    expect(resolveResizeDimensions(400, 200, 300, 300, true)).toEqual({ width: 300, height: 300 });
  });

  it('never returns a dimension below 1', () => {
    expect(resolveResizeDimensions(400, 200, 0, null, true)).toEqual({ width: 1, height: 1 });
  });

  it('rounds fractional results', () => {
    expect(resolveResizeDimensions(300, 100, 100, null, true)).toEqual({ width: 100, height: 33 });
  });
});
