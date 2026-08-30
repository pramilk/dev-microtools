import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadZip, uniqueZipName } from './downloadZip';

describe('uniqueZipName', () => {
  it('returns the plain name when there is no collision', () => {
    const used = new Set<string>();
    expect(uniqueZipName('photo', 'jpg', used)).toBe('photo.jpg');
    expect(used.has('photo.jpg')).toBe(true);
  });

  it('appends an incrementing suffix on collision', () => {
    const used = new Set(['photo.jpg']);
    expect(uniqueZipName('photo', 'jpg', used)).toBe('photo-1.jpg');
  });

  it('keeps incrementing past multiple collisions', () => {
    const used = new Set(['photo.jpg', 'photo-1.jpg', 'photo-2.jpg']);
    expect(uniqueZipName('photo', 'jpg', used)).toBe('photo-3.jpg');
  });
});

describe('downloadZip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('zips the given blobs under their names and downloads the archive', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:zip-url'), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createSpy = vi.spyOn(document, 'createElement');

    await downloadZip(
      [
        { name: 'a.jpg', blob: new Blob([new Uint8Array([1, 2, 3])]) },
        { name: 'b.jpg', blob: new Blob([new Uint8Array([4, 5])]) },
      ],
      'images.zip'
    );

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const link = createSpy.mock.results.find((r) => (r.value as HTMLAnchorElement).tagName === 'A')!.value as HTMLAnchorElement;
    expect(link.download).toBe('images.zip');
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:zip-url');
  });
});
