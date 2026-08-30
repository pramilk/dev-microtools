import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadUrl } from './downloadUrl';

describe('downloadUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a temporary anchor with the given href and filename, clicks it, then removes it', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    const createSpy = vi.spyOn(document, 'createElement');

    downloadUrl('blob:fake-url', 'photo.jpg');

    expect(createSpy).toHaveBeenCalledWith('a');
    const link = createSpy.mock.results[0]!.value as HTMLAnchorElement;
    expect(link.href).toBe('blob:fake-url');
    expect(link.download).toBe('photo.jpg');
    expect(appendSpy).toHaveBeenCalledWith(link);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith(link);
  });
});
