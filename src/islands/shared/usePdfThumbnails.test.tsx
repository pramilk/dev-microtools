import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';
import { usePdfThumbnailSet, usePdfThumbnails } from './usePdfThumbnails';

// pdf.js needs a real canvas, which jsdom lacks; the hook's job is the queueing and lifecycle
// around it, so the renderer is a controllable stand-in.
const renderer = vi.hoisted(() => ({
  open: vi.fn(),
  render: vi.fn(),
  renderPixels: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('./pdfThumbnails', () => ({ openThumbnailDocument: renderer.open }));

const file = (name = 'a.pdf') => new File(['%PDF-1.7'], name, { type: 'application/pdf' });

beforeEach(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:thumb-${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
  renderer.render.mockReset().mockImplementation(async (page: number) => new Blob([`page ${page}`]));
  renderer.destroy.mockReset().mockResolvedValue(undefined);
  renderer.renderPixels.mockReset().mockResolvedValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
  renderer.open.mockReset().mockImplementation(async () => ({ pageCount: 5, render: renderer.render, renderPixels: renderer.renderPixels, destroy: renderer.destroy }));
});

describe('usePdfThumbnails', () => {
  it('draws only the pages that are asked for', async () => {
    const pdf = file();
    const { result } = renderHook(() => usePdfThumbnails(pdf));
    await waitFor(() => expect(renderer.open).toHaveBeenCalledTimes(1));
    act(() => result.current.request(2));
    await waitFor(() => expect(result.current.thumbnailFor(2)).toMatch(/^blob:thumb-/));
    expect(result.current.thumbnailFor(0)).toBeUndefined();
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledWith(2, 120, 160);
  });

  it('replays requests made before the document opened, skipping pages it doesn’t have', async () => {
    const pdf = file();
    const { result } = renderHook(() => usePdfThumbnails(pdf));
    act(() => {
      result.current.request(0);
      result.current.request(9);
      result.current.request(0);
    });
    await waitFor(() => expect(result.current.thumbnailFor(0)).toBeDefined());
    expect(renderer.render.mock.calls.map(([page]) => page)).toEqual([0]);
  });

  it('draws the most recently requested page first', async () => {
    let release: () => void = () => {};
    renderer.render.mockImplementationOnce(
      (page: number) =>
        new Promise<Blob>((resolve) => {
          release = () => resolve(new Blob([`page ${page}`]));
        })
    );
    const pdf = file();
    const { result } = renderHook(() => usePdfThumbnails(pdf));
    await waitFor(() => expect(renderer.open).toHaveBeenCalled());
    act(() => result.current.request(0));
    await waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.request(1);
      result.current.request(4);
    });
    release();
    await waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(3));
    expect(renderer.render.mock.calls.map(([page]) => page)).toEqual([0, 4, 1]);
  });

  it('marks a page that fails to draw, and carries on with the rest', async () => {
    renderer.render.mockImplementation(async (page: number) => {
      if (page === 1) throw new Error('bad page');
      return new Blob(['ok']);
    });
    const pdf = file();
    const { result } = renderHook(() => usePdfThumbnails(pdf));
    act(() => {
      result.current.request(1);
      result.current.request(2);
    });
    await waitFor(() => expect(result.current.hasFailed(1)).toBe(true));
    await waitFor(() => expect(result.current.thumbnailFor(2)).toBeDefined());
    expect(result.current.hasFailed(2)).toBe(false);
  });

  it('reports why when the document can’t be opened at all', async () => {
    renderer.open.mockRejectedValue(new Error('Invalid PDF structure.'));
    const pdf = file();
    const { result } = renderHook(() => usePdfThumbnails(pdf));
    await waitFor(() => expect(result.current.unavailable).toBe('Invalid PDF structure.'));
  });

  it('releases the document and its images when the file changes or goes away', async () => {
    const { result, rerender } = renderHook(({ current }: { current: File | null }) => usePdfThumbnails(current), { initialProps: { current: file('a.pdf') as File | null } });
    act(() => result.current.request(0));
    await waitFor(() => expect(result.current.thumbnailFor(0)).toBe('blob:thumb-1'));

    rerender({ current: file('b.pdf') });
    await waitFor(() => expect(renderer.destroy).toHaveBeenCalledTimes(1));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1');
    expect(result.current.thumbnailFor(0)).toBeUndefined();

    rerender({ current: null });
    await waitFor(() => expect(renderer.destroy).toHaveBeenCalledTimes(2));
    expect(renderer.open).toHaveBeenCalledTimes(2);
  });

  it('does nothing without a file', () => {
    const { result } = renderHook(() => usePdfThumbnails(null));
    act(() => result.current.request(0));
    expect(renderer.open).not.toHaveBeenCalled();
    expect(result.current.unavailable).toBeNull();
  });

  it('draws a page large on request, once the document is open', async () => {
    const pdf = file();
    const { result } = renderHook(() => usePdfThumbnails(pdf));
    await waitFor(() => expect(renderer.open).toHaveBeenCalled());
    expect(await result.current.renderLarge(3)).toBeInstanceOf(Blob);
    expect(renderer.render).toHaveBeenCalledWith(3, 900, 1200);
  });
});

describe('usePdfThumbnailSet', () => {
  it('keeps each file’s pages apart and releases only a file that goes away', async () => {
    const a = file('a.pdf');
    const b = file('b.pdf');
    const { result, rerender } = renderHook(({ files }: { files: File[] }) => usePdfThumbnailSet(files), { initialProps: { files: [a, b] } });
    await waitFor(() => expect(renderer.open).toHaveBeenCalledTimes(2));
    act(() => {
      result.current.request(a, 0);
      result.current.request(b, 0);
    });
    await waitFor(() => expect(result.current.thumbnailFor(b, 0)).toBeDefined());
    await waitFor(() => expect(result.current.thumbnailFor(a, 0)).toBeDefined());
    expect(result.current.thumbnailFor(a, 0)).not.toBe(result.current.thumbnailFor(b, 0));
    expect(result.current.thumbnailFor(a, 1)).toBeUndefined();

    const kept = result.current.thumbnailFor(a, 0);
    rerender({ files: [a] });
    await waitFor(() => expect(renderer.destroy).toHaveBeenCalledTimes(1));
    expect(result.current.thumbnailFor(b, 0)).toBeUndefined();
    expect(result.current.thumbnailFor(a, 0)).toBe(kept);
    expect(renderer.open).toHaveBeenCalledTimes(2);
  });

  it('measures a page’s pixels, and rejects for a file that isn’t open', async () => {
    const a = file();
    const { result } = renderHook(() => usePdfThumbnailSet([a]));
    await expect(result.current.pixels(file('other.pdf'), 0)).rejects.toThrow(/isn’t open/);
    await act(async () => {
      expect(await result.current.pixels(a, 2)).toEqual({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
    });
    expect(renderer.renderPixels).toHaveBeenCalledWith(2, 150, 200);
  });
});
