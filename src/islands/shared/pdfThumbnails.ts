import { AnnotationMode, GlobalWorkerOptions, getDocument, version } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { FORMAT_INFO, planRender, type PageImageFormat } from '../../lib/tools/pdfToImage';

/**
 * Draws PDF pages as small images with pdf.js. Only ever loaded through a dynamic `import()`
 * (see `usePdfThumbnails`), once a PDF has been chosen — pdf.js and its worker are far too
 * big to be part of any page load.
 *
 * pdf.js is given the file's bytes directly, so nothing leaves the device. The only requests
 * it makes are same-origin, for its own data files under `/vendor/pdfjs-<version>/` (copied
 * there at build time by the `pdfjs-assets` integration in `astro.config.mjs`), and only when
 * a PDF needs one: a WebAssembly image decoder, a standard font, or a CJK CMap.
 */

GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = `/vendor/pdfjs-${version}/`;

/** A page drawn to raw RGBA pixels, for measuring rather than showing. */
export interface PagePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A page drawn at full size as a downloadable image. */
export interface PageImage {
  blob: Blob;
  width: number;
  height: number;
  /** Drawn smaller than the requested DPI, to stay within what a canvas can hold. */
  capped: boolean;
}

export interface PageImageOptions {
  format: PageImageFormat;
  /** JPEG quality, 0–1. */
  quality: number;
  dpi: number;
  /** PNG only: no white page background. */
  transparent: boolean;
}

export interface ThumbnailDocument {
  readonly pageCount: number;
  /** Draws a page at `dpi` and encodes it as a JPEG or PNG — the PDF to Image output. */
  renderImage(pageIndex: number, options: PageImageOptions): Promise<PageImage>;
  /** Renders a page to fit inside `width` × `height` CSS pixels (sharp on high-DPI screens). */
  render(pageIndex: number, width: number, height: number): Promise<Blob>;
  /** Renders a page to fit inside `width` × `height` device pixels and returns its pixels. */
  renderPixels(pageIndex: number, width: number, height: number): Promise<PagePixels>;
  destroy(): Promise<void>;
}

export async function openThumbnailDocument(bytes: Uint8Array): Promise<ThumbnailDocument> {
  const task = getDocument({
    data: bytes,
    enableXfa: false,
    wasmUrl: `${ASSETS}wasm/`,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    cMapUrl: `${ASSETS}cmaps/`,
    verbosity: 0,
  });
  const doc = await task.promise;

  /** Draws a page onto a fresh canvas scaled to fit `width` × `height`, times `pixelRatio`. */
  const draw = async (pageIndex: number, width: number, height: number, pixelRatio: number): Promise<HTMLCanvasElement> => {
    const page = await doc.getPage(pageIndex + 1);
    try {
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(width / natural.width, height / natural.height) * pixelRatio;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
      return canvas;
    } finally {
      page.cleanup();
    }
  };

  return {
    pageCount: doc.numPages,
    async render(pageIndex, width, height) {
      const canvas = await draw(pageIndex, width, height, Math.min(2, window.devicePixelRatio || 1));
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the page couldn’t be turned into an image'))), 'image/jpeg', 0.85)
      );
    },
    async renderImage(pageIndex, options) {
      const page = await doc.getPage(pageIndex + 1);
      let canvas: HTMLCanvasElement | null = null;
      try {
        const natural = page.getViewport({ scale: 1 });
        const plan = planRender(natural.width, natural.height, options.dpi);
        const viewport = page.getViewport({ scale: plan.scale });
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        await page.render({
          canvas,
          viewport,
          annotationMode: AnnotationMode.ENABLE,
          ...(options.format === 'png' && options.transparent ? { background: 'rgba(0, 0, 0, 0)' } : {}),
        }).promise;
        const drawn = canvas;
        const blob = await new Promise<Blob>((resolve, reject) =>
          drawn.toBlob(
            (made) => (made ? resolve(made) : reject(new Error('this browser couldn’t encode the page — try a lower resolution'))),
            FORMAT_INFO[options.format].mime,
            options.format === 'jpeg' ? options.quality : undefined
          )
        );
        return { blob, width: canvas.width, height: canvas.height, capped: plan.capped };
      } finally {
        // Frees the bitmap now rather than whenever the garbage collector gets to it — a
        // 300 DPI page is tens of megabytes, and Safari caps total canvas memory.
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        page.cleanup();
      }
    },
    async renderPixels(pageIndex, width, height) {
      const canvas = await draw(pageIndex, width, height, 1);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('this browser can’t read back a drawn page');
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      return { data, width: canvas.width, height: canvas.height };
    },
    destroy: () => task.destroy(),
  };
}
