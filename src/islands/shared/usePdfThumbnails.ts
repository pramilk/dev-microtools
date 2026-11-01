import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PagePixels, ThumbnailDocument } from './pdfThumbnails';

/** The box each thumbnail is drawn to fit, in CSS pixels — matches `.pdf-thumb__frame`. */
export const THUMBNAIL_WIDTH = 120;
export const THUMBNAIL_HEIGHT = 160;

interface Session {
  file: File;
  cancelled: boolean;
  doc: ThumbnailDocument | null;
  /** Settles when the document opens (or fails to). */
  ready: Promise<ThumbnailDocument>;
  urls: string[];
}

interface Job {
  file: File;
  page: number;
}

export interface PdfThumbnails {
  /** The page's image, once drawn. */
  thumbnailFor: (pageIndex: number) => string | undefined;
  hasFailed: (pageIndex: number) => boolean;
  /** Why no thumbnails can be drawn for this file at all (pdf.js couldn't open it), if so. */
  unavailable: string | null;
  /** Asks for a page to be drawn — call it when its card scrolls into view. */
  request: (pageIndex: number) => void;
  /** Draws a page large, for viewing it in full (see `PdfPageViewer`). */
  renderLarge: (pageIndex: number) => Promise<Blob>;
}

/** `PdfThumbnails` for several files at once, each page addressed by its file. */
export interface PdfThumbnailSet {
  thumbnailFor: (file: File, pageIndex: number) => string | undefined;
  hasFailed: (file: File, pageIndex: number) => boolean;
  unavailable: (file: File) => string | null;
  request: (file: File, pageIndex: number) => void;
  /** Draws a page large, for viewing it in full. Waits for the file's document to open. */
  renderLarge: (file: File, pageIndex: number) => Promise<Blob>;
  /** Draws a page small and returns its pixels — for measuring it (e.g. "is it blank?"),
   *  not for showing. Waits for the file's document to open; rejects if it can't. */
  pixels: (file: File, pageIndex: number) => Promise<PagePixels>;
}

/** pdf.js, loaded once on first use and shared by every file — never on page load. A failed
 *  load (a dropped connection) isn't kept, so the next file tries again. */
let rendererModule: Promise<typeof import('./pdfThumbnails')> | null = null;
const loadRenderer = () =>
  (rendererModule ??= import('./pdfThumbnails').catch((thrown: unknown) => {
    rendererModule = null;
    throw thrown;
  }));

/** The box a page is drawn to fit for viewing in full, in CSS pixels (sharp on high-DPI
 *  screens) — about the size it's shown at in `PdfPageViewer` on a desktop. */
export const LARGE_WIDTH = 900;
export const LARGE_HEIGHT = 1200;

/** The size pages are drawn at for `pixels` — plenty to see a line of text, cheap to scan. */
const MEASURE_WIDTH = 150;
const MEASURE_HEIGHT = 200;

/**
 * Lazily draws page thumbnails for every PDF in `files`, one page at a time across all of them,
 * only for pages that have been asked for. pdf.js is loaded on the first file, never on page
 * load. Drawing happens on the main thread (pdf.js parses in its own worker, but paints to a
 * canvas here), so pages are drawn strictly one after another, yielding between them, to keep
 * the page responsive while a long document fills in.
 *
 * A file leaving `files` releases everything it held (images, its pdf.js document).
 */
export function usePdfThumbnailSet(files: readonly File[]): PdfThumbnailSet {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [unavailable, setUnavailable] = useState<ReadonlyMap<File, string>>(new Map());
  const sessionsRef = useRef(new Map<File, Session>());
  /** Pages waiting to be drawn. Taken from the end, so the most recently scrolled-to pages
   *  come first and a fast scroll doesn't wait behind everything it scrolled past. */
  const queueRef = useRef<Job[]>([]);
  const runningRef = useRef(false);
  /** Requests can arrive before their file's document has opened (a card's mount effect runs
   *  before this hook's), so they're remembered per file and replayed when it opens. */
  const wantedRef = useRef(new Map<File, Set<number>>());
  const idsRef = useRef({ next: 1, byFile: new WeakMap<File, number>() });

  const idOf = useCallback((file: File): number => {
    const ids = idsRef.current;
    let id = ids.byFile.get(file);
    if (id === undefined) {
      id = ids.next++;
      ids.byFile.set(file, id);
    }
    return id;
  }, []);
  const keyOf = useCallback((file: File, page: number) => `${idOf(file)}:${page}`, [idOf]);

  const pump = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    for (let job = queueRef.current.pop(); job; job = queueRef.current.pop()) {
      const session = sessionsRef.current.get(job.file);
      if (!session?.doc || session.cancelled) continue;
      const key = keyOf(job.file, job.page);
      try {
        const blob = await session.doc.render(job.page, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
        if (session.cancelled) continue;
        const url = URL.createObjectURL(blob);
        session.urls.push(url);
        setUrls((prev) => new Map(prev).set(key, url));
      } catch {
        // One damaged page shouldn't stop the rest: its card shows a placeholder instead.
        if (!session.cancelled) setFailed((prev) => new Set(prev).add(key));
      }
      // Let input and painting in before the next page.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    runningRef.current = false;
  }, [keyOf]);

  const close = useCallback(
    (session: Session) => {
      session.cancelled = true;
      void session.doc?.destroy();
      for (const url of session.urls) URL.revokeObjectURL(url);
      sessionsRef.current.delete(session.file);
      wantedRef.current.delete(session.file);
      const prefix = `${idOf(session.file)}:`;
      setUrls((prev) => new Map([...prev].filter(([key]) => !key.startsWith(prefix))));
      setFailed((prev) => new Set([...prev].filter((key) => !key.startsWith(prefix))));
      setUnavailable((prev) => {
        if (!prev.has(session.file)) return prev;
        const next = new Map(prev);
        next.delete(session.file);
        return next;
      });
    },
    [idOf]
  );

  const open = useCallback(
    (file: File) => {
      const state: Omit<Session, 'ready'> = { file, cancelled: false, doc: null, urls: [] };
      const ready = (async () => {
        const { openThumbnailDocument } = await loadRenderer();
        const doc = await openThumbnailDocument(new Uint8Array(await file.arrayBuffer()));
        if (state.cancelled) {
          void doc.destroy();
          throw new Error('the file was closed');
        }
        state.doc = doc;
        const wanted = [...(wantedRef.current.get(file) ?? [])].filter((page) => page < doc.pageCount);
        queueRef.current.push(...wanted.reverse().map((page) => ({ file, page })));
        void pump();
        return doc;
      })();
      // The same object the loader above updates, now with its promise attached.
      const session: Session = Object.assign(state, { ready });
      ready.catch((thrown: unknown) => {
        if (!session.cancelled) setUnavailable((prev) => new Map(prev).set(file, thrown instanceof Error && thrown.message ? thrown.message : 'the previewer couldn’t open this file'));
      });
      sessionsRef.current.set(file, session);
    },
    [pump]
  );

  const filesKey = files.map(idOf).join(',');
  useEffect(() => {
    const current = new Set(files);
    for (const session of [...sessionsRef.current.values()]) if (!current.has(session.file)) close(session);
    for (const file of files) if (!sessionsRef.current.has(file)) open(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  useEffect(
    () => () => {
      for (const session of [...sessionsRef.current.values()]) close(session);
    },
    [close]
  );

  const request = useCallback(
    (file: File, page: number) => {
      let wanted = wantedRef.current.get(file);
      if (!wanted) wantedRef.current.set(file, (wanted = new Set()));
      if (wanted.has(page)) return;
      wanted.add(page);
      // Until the document has opened, the replay when it does picks this page up — queueing it
      // here as well would draw it twice.
      const session = sessionsRef.current.get(file);
      if (session?.doc && page < session.doc.pageCount) {
        queueRef.current.push({ file, page });
        void pump();
      }
    },
    [pump]
  );

  const documentFor = useCallback(async (file: File): Promise<ThumbnailDocument> => {
    const session = sessionsRef.current.get(file);
    if (!session) throw new Error('this file isn’t open');
    return session.ready;
  }, []);
  const pixels = useCallback(async (file: File, page: number) => (await documentFor(file)).renderPixels(page, MEASURE_WIDTH, MEASURE_HEIGHT), [documentFor]);
  const renderLarge = useCallback(async (file: File, page: number) => (await documentFor(file)).render(page, LARGE_WIDTH, LARGE_HEIGHT), [documentFor]);

  return {
    thumbnailFor: (file, page) => urls.get(keyOf(file, page)),
    hasFailed: (file, page) => failed.has(keyOf(file, page)),
    unavailable: (file) => unavailable.get(file) ?? null,
    request,
    renderLarge,
    pixels,
  };
}

/**
 * `usePdfThumbnailSet` for one file — the shape Split PDF uses. Pass `null` to stop and release
 * everything (images, the pdf.js document).
 */
export function usePdfThumbnails(file: File | null): PdfThumbnails {
  const files = useMemo(() => (file ? [file] : []), [file]);
  const set = usePdfThumbnailSet(files);
  return {
    thumbnailFor: (page) => (file ? set.thumbnailFor(file, page) : undefined),
    hasFailed: (page) => (file ? set.hasFailed(file, page) : false),
    unavailable: file ? set.unavailable(file) : null,
    request: (page) => {
      if (file) set.request(file, page);
    },
    renderLarge: (page) => (file ? set.renderLarge(file, page) : Promise.reject(new Error('no PDF is open'))),
  };
}
