import { describe, it, expect } from 'vitest';
import { validateImageFile, computeTargetDimensions, MAX_INPUT_FILE_SIZE } from './imageCompress';

describe('validateImageFile', () => {
  it('accepts a JPEG under the size limit', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 1024, name: 'photo.jpg' })).toEqual({ ok: true, value: true });
  });

  it('accepts a PNG and a WebP under the size limit', () => {
    expect(validateImageFile({ type: 'image/png', size: 1024, name: 'a.png' }).ok).toBe(true);
    expect(validateImageFile({ type: 'image/webp', size: 1024, name: 'a.webp' }).ok).toBe(true);
  });

  it('allows a file with no declared type through when its extension still looks like an image', () => {
    expect(validateImageFile({ type: '', size: 1024, name: 'photo.jpg' })).toEqual({ ok: true, value: true });
  });

  it('rejects a file with no declared type and no recognizable image extension, instead of waving it through unconditionally', () => {
    // This is the actual hole that let drag-and-dropping a non-image file (which bypasses an
    // <input accept> filter entirely — that only constrains the file-picker dialog) succeed:
    // many non-image files also arrive with a blank `type` from certain drag sources.
    const result = validateImageFile({ type: '', size: 1024, name: 'resume.docx' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/doesn't look like an image/i);
  });

  it('rejects an animated-capable GIF with a message explaining why, not a generic error', () => {
    const result = validateImageFile({ type: 'image/gif', size: 1024, name: 'a.gif' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/animation/i);
  });

  it('rejects SVG and points to the SVG Optimizer instead', () => {
    const result = validateImageFile({ type: 'image/svg+xml', size: 1024, name: 'a.svg' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/svg optimizer/i);
  });

  it('rejects a non-image file with a declared type', () => {
    const result = validateImageFile({ type: 'application/pdf', size: 1024, name: 'doc.pdf' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not an image/i);
  });

  it('rejects a file over the size limit', () => {
    const result = validateImageFile({ type: 'image/png', size: MAX_INPUT_FILE_SIZE + 1, name: 'huge.png' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });

  it('accepts a file exactly at the size limit', () => {
    expect(validateImageFile({ type: 'image/png', size: MAX_INPUT_FILE_SIZE, name: 'edge.png' }).ok).toBe(true);
  });
});

describe('computeTargetDimensions', () => {
  it('leaves dimensions unchanged when no cap is given', () => {
    expect(computeTargetDimensions(1000, 500, null)).toEqual({ width: 1000, height: 500 });
  });

  it('leaves dimensions unchanged when the cap is non-positive', () => {
    expect(computeTargetDimensions(1000, 500, 0)).toEqual({ width: 1000, height: 500 });
    expect(computeTargetDimensions(1000, 500, -10)).toEqual({ width: 1000, height: 500 });
  });

  it('leaves dimensions unchanged when the image is already within the cap', () => {
    expect(computeTargetDimensions(400, 300, 1000)).toEqual({ width: 400, height: 300 });
  });

  it('downscales a landscape image, preserving aspect ratio', () => {
    expect(computeTargetDimensions(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
  });

  it('downscales a portrait image against its taller side', () => {
    expect(computeTargetDimensions(1000, 2000, 1000)).toEqual({ width: 500, height: 1000 });
  });

  it('downscales a square image', () => {
    expect(computeTargetDimensions(2000, 2000, 500)).toEqual({ width: 500, height: 500 });
  });

  it('caps the longer side exactly when the image is already square at the cap', () => {
    expect(computeTargetDimensions(500, 500, 500)).toEqual({ width: 500, height: 500 });
  });

  it('never rounds a dimension down to zero for an extreme aspect ratio', () => {
    const result = computeTargetDimensions(10000, 1, 10);
    expect(result.width).toBe(10);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});
