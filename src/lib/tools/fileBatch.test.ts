import { describe, it, expect } from 'vitest';
import { batchRoom, moveItem, normalizePdfName, plural, sortByName } from './fileBatch';

// moveItem, sortByName and the Merge PDF wrappers are covered in depth by pdfMerge.test.ts,
// which still imports them through pdfMerge.ts; these cover the generic parameters.

const limits = { maxFiles: 3, maxBytes: 100, toolName: 'Test Tool', noun: 'thing', sizeAdvice: 'Try fewer.' };

describe('batchRoom (generic limits)', () => {
  it('uses the given tool name and noun in the count message', () => {
    const result = batchRoom({ count: 2, bytes: 0 }, [1, 1, 1], limits);
    expect(result).toEqual({ accepted: 1, error: 'Test Tool takes up to 3 things at once — 2 things weren’t added.' });
  });

  it('uses the given size advice, and accepts an empty batch', () => {
    expect(batchRoom({ count: 0, bytes: 90 }, [20], limits).error).toMatch(/Those things would take the batch past .* MB in total — 1 thing wasn’t added\. Try fewer\./);
    expect(batchRoom({ count: 0, bytes: 0 }, [], limits)).toEqual({ accepted: 0, error: null });
  });
});

describe('normalizePdfName', () => {
  it('uses the caller’s fallback name', () => {
    expect(normalizePdfName('', 'images.pdf')).toBe('images.pdf');
    expect(normalizePdfName('report', 'images.pdf')).toBe('report.pdf');
  });
});

describe('plural / moveItem / sortByName', () => {
  it('work on any item type', () => {
    expect(plural(2, 'image')).toBe('2 images');
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(sortByName(['IMG_10.jpg', 'IMG_2.jpg'], (name) => name)).toEqual(['IMG_2.jpg', 'IMG_10.jpg']);
  });
});
