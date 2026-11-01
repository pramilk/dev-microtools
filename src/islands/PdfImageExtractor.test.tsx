import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import PdfImageExtractor from './PdfImageExtractor';

// jsdom has no Worker, canvas or OffscreenCanvas. The mocked worker runs the real request
// handler (so the real pdf-lib engine runs end to end) with a fake PNG encoder, and serves
// "Load example" from the real sample builder fed a minimal JPEG header.
vi.mock('../workers/pdfImageExtract.worker?worker', async () => {
  const { createFakeWorkerClass } = await import('../../test/fakeWorker');
  const { handlePdfImageExtractRequest } = await import('../workers/pdfImageExtract.worker');
  const { buildSamplePdf } = await import('../lib/tools/pdfImageExtractEngine');
  const jpeg = new Uint8Array(20_000);
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x04, 0xb0, 0x03]);
  const codec = {
    decodeJpeg: async (_bytes: Uint8Array, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4).fill(128), width, height }),
    encodePng: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  };
  type Request = Parameters<typeof handlePdfImageExtractRequest>[0];
  return {
    default: createFakeWorkerClass(async (request: Request) =>
      request.kind === 'sample' ? { kind: 'sample' as const, bytes: await buildSamplePdf(jpeg) } : handlePdfImageExtractRequest(request, codec)
    ),
  };
});

const pdfFile = (bytes: Uint8Array | string, name = 'report.pdf', type = 'application/pdf') =>
  new File([typeof bytes === 'string' ? bytes : (bytes as Uint8Array<ArrayBuffer>)], name, { type });

function drop(file: File) {
  const dropzone = screen.getByText(/drag a file here/i).closest('.dropzone');
  if (!dropzone) throw new Error('dropzone not found');
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
}

async function loadExample() {
  fireEvent.click(screen.getByRole('button', { name: /load example/i }));
  return screen.findByRole('list', { name: /extracted images/i }, { timeout: 10_000 });
}

beforeEach(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake-${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PdfImageExtractor', () => {
  it('renders the example and clear controls and a dropzone, with Clear disabled when empty', () => {
    render(<PdfImageExtractor />);
    expect(screen.getByRole('button', { name: /load example/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(screen.getByLabelText(/choose a pdf to extract images from/i)).toBeInTheDocument();
  });

  it('extracts the example into a gallery, hiding tiny images until asked', async () => {
    render(<PdfImageExtractor />);
    const gallery = await loadExample();
    expect(screen.getByText(/sample-brochure\.pdf/)).toBeInTheDocument();
    expect(screen.getByTestId('pie-result')).toHaveTextContent(/4 images from 2 pages/);
    expect(screen.getByTestId('pie-result')).toHaveTextContent(/1 repeated copy shown once/);

    const cards = within(gallery).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent(/1200×800 · JPEG/);
    expect(cards[1]).toHaveTextContent(/160×160 · PNG/);
    expect(cards[1]).toHaveTextContent(/pp\. 1, 2/);
    expect(cards[1]).toHaveTextContent(/transparent/);
    expect(screen.getByRole('button', { name: /download all \(3\) as zip/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /show 1 tiny image/i }));
    expect(within(gallery).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /download all \(4\) as zip/i })).toBeInTheDocument();
  });

  it('opens an image in the viewer, steps with the arrow keys and closes', async () => {
    render(<PdfImageExtractor />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: /view image 1 \(1200×800 jpeg\) larger/i }));

    const viewer = screen.getByRole('dialog', { name: /image 1 of 4/i });
    expect(viewer).toHaveAttribute('open');
    expect(within(viewer).getByRole('img', { name: /image 1 extracted from sample-brochure\.pdf/i })).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    expect(within(viewer).getByRole('link', { name: /open in new tab/i })).toHaveAttribute('target', '_blank');

    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: /image 2 of 4/i })).toBeInTheDocument();
    fireEvent.keyDown(viewer, { key: 'ArrowLeft' });
    fireEvent.keyDown(viewer, { key: 'ArrowLeft' });
    // Wraps around past the first image to the last visible one.
    expect(screen.getByRole('dialog', { name: /image 4 of 4/i })).toBeInTheDocument();

    fireEvent.click(within(viewer).getByRole('button', { name: /close viewer/i }));
    await waitFor(() => expect(viewer).not.toHaveAttribute('open'));
  });

  it('downloads a single image with a descriptive file name', async () => {
    render(<PdfImageExtractor />);
    const gallery = await loadExample();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    fireEvent.click(within(within(gallery).getAllByRole('listitem')[1]).getByRole('button', { name: /download/i }));
    expect(downloads).toEqual(['sample-brochure-p1-img02.png']);
  });

  it('downloads every visible image as one ZIP', async () => {
    render(<PdfImageExtractor />);
    await loadExample();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    fireEvent.click(screen.getByRole('button', { name: /download all \(3\) as zip/i }));
    await waitFor(() => expect(downloads).toEqual(['sample-brochure-images.zip']), { timeout: 5000 });
  });

  it('says so clearly when a PDF has no images', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage().drawText('Just text');
    render(<PdfImageExtractor />);
    drop(pdfFile(await doc.save()));
    const result = await screen.findByTestId('pie-result', {}, { timeout: 5000 });
    expect(result).toHaveTextContent(/No images found in this PDF’s 1 page/);
    expect(screen.queryByRole('button', { name: /download all/i })).toBeNull();
  });

  it('shows a helpful error for a file that is not a PDF', async () => {
    render(<PdfImageExtractor />);
    drop(pdfFile('hello', 'photo.png', 'image/png'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a PDF/);
  });

  it('shows a helpful error for a .pdf file whose contents are not a PDF', async () => {
    render(<PdfImageExtractor />);
    drop(pdfFile('just some text renamed to pdf'));
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/doesn’t start with a PDF header/);
  });

  it('Clear removes the file and the gallery', async () => {
    render(<PdfImageExtractor />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByRole('list', { name: /extracted images/i })).toBeNull();
    expect(screen.queryByText(/sample-brochure\.pdf/)).toBeNull();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
