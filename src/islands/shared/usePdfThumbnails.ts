import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ThumbnailDocument } from './pdfThumbnails';

/** The box each thumbnail is drawn to fit, in CSS pixels — matches `.pdf-thumb__frame`. */
export const THUMBNAIL_WIDTH = 120;
export const THUMBNAIL_HEIGHT = 160;

interface Session {
  file: File;
  cancelled: boolean;
  doc: ThumbnailDocument | null;
  /** Pages waiting to be drawn. Taken from the end, so the most recently scrolled-to pages
   *  come first and a fast scroll doesn't wait behind everything it scrolled past. */
  queue: number[];
  running: boolean;
  urls: string[];
}

export interface PdfThumbnails {
  /** The page's image, once drawn. */
  thumbnailFor: (pageIndex: number) => string | undefined;
  hasFailed: (pageIndex: number) => boolean;
  /** Why no thumbnails can be drawn for this file at all (pdf.js couldn't open it), if so. */
  unavailable: string | null;
  /** Asks for a page to be drawn — call it when its card scrolls into view. */
  request: (pageIndex: number) => void;
}

/**
 * Lazily draws page thumbnails for `file`, one page at a time, only for pages that have been
 * asked for. pdf.js is loaded on the first file, never on page load. Drawing happens on the
 * main thread (pdf.js parses in its own worker, but paints to a canvas here), so pages are
 * drawn strictly one after another, yielding between them, to keep the page responsive while
 * a long document fills in.
 *
 * Pass `null` to stop and release everything (images, the pdf.js document).
 */
export function usePdfThumbnails(file: File | null): PdfThumbnails {
  const [urls, setUrls] = useState<ReadonlyMap<number, string>>(new Map());
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  /** Requests can arrive before the session for their file exists (a card's mount effect runs
   *  before this hook's), so they're remembered per file and replayed when it opens. */
  const wantedRef = useRef<{ file: File | null; pages: Set<number> }>({ file: null, pages: new Set() });
  const fileRef = useRef(file);
  fileRef.current = file;

  const pump = useCallback(async (session: Session): Promise<void> => {
    const { doc } = session;
    if (session.running || !doc) return;
    session.running = true;
    while (!session.cancelled) {
      const page = session.queue.pop();
      if (page === undefined) break;
      try {
        const blob = await doc.render(page, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
        if (session.cancelled) break;
        const url = URL.createObjectURL(blob);
        session.urls.push(url);
        setUrls((prev) => new Map(prev).set(page, url));
      } catch {
        // One damaged page shouldn't stop the rest: its card shows a placeholder instead.
        if (!session.cancelled) setFailed((prev) => new Set(prev).add(page));
      }
      // Let input and painting in before the next page.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    session.running = false;
  }, []);

  useEffect(() => {
    setUrls(new Map());
    setFailed(new Set());
    setUnavailable(null);
    if (!file) return undefined;

    const session: Session = { file, cancelled: false, doc: null, queue: [], running: false, urls: [] };
    sessionRef.current = session;
    void (async () => {
      try {
        const { openThumbnailDocument } = await import('./pdfThumbnails');
        const doc = await openThumbnailDocument(new Uint8Array(await file.arrayBuffer()));
        if (session.cancelled) {
          void doc.destroy();
          return;
        }
        session.doc = doc;
        const wanted = wantedRef.current.file === file ? [...wantedRef.current.pages] : [];
        session.queue.push(...wanted.filter((page) => page < doc.pageCount).reverse());
        void pump(session);
      } catch (thrown: unknown) {
        if (!session.cancelled) setUnavailable(thrown instanceof Error && thrown.message ? thrown.message : 'the previewer couldn’t open this file');
      }
    })();

    return () => {
      session.cancelled = true;
      void session.doc?.destroy();
      for (const url of session.urls) URL.revokeObjectURL(url);
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [file, pump]);

  const request = useCallback(
    (pageIndex: number) => {
      const current = fileRef.current;
      if (!current) return;
      if (wantedRef.current.file !== current) wantedRef.current = { file: current, pages: new Set() };
      if (wantedRef.current.pages.has(pageIndex)) return;
      wantedRef.current.pages.add(pageIndex);
      // Until the document has opened, the replay when it does picks this page up — queueing it
      // here as well would draw it twice.
      const session = sessionRef.current;
      if (session && session.file === current && session.doc && pageIndex < session.doc.pageCount) {
        session.queue.push(pageIndex);
        void pump(session);
      }
    },
    [pump]
  );

  return {
    thumbnailFor: (pageIndex) => urls.get(pageIndex),
    hasFailed: (pageIndex) => failed.has(pageIndex),
    unavailable,
    request,
  };
}
