import { AnnotationMode, GlobalWorkerOptions, getDocument, version } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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

export interface ThumbnailDocument {
  readonly pageCount: number;
  /** Renders a page to fit inside `width` × `height` CSS pixels (sharp on high-DPI screens). */
  render(pageIndex: number, width: number, height: number): Promise<Blob>;
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

  return {
    pageCount: doc.numPages,
    async render(pageIndex, width, height) {
      const page = await doc.getPage(pageIndex + 1);
      try {
        const natural = page.getViewport({ scale: 1 });
        const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
        const scale = Math.min(width / natural.width, height / natural.height) * pixelRatio;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
        return await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the page couldn’t be turned into an image'))), 'image/jpeg', 0.85)
        );
      } finally {
        page.cleanup();
      }
    },
    destroy: () => task.destroy(),
  };
}
