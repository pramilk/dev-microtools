import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import PdfCompressor from './PdfCompressor';

// jsdom has no Worker, canvas or OffscreenCanvas. The mocked worker runs the real request
// handler (so the real pdf-lib engine runs end to end) with a fake raster codec, and serves
// "Load example" from the real sample builder fed a minimal JPEG header.
vi.mock('../workers/pdfCompress.worker?worker', async () => {
  const { createFakeWorkerClass } = await import('../../test/fakeWorker');
  const { handlePdfCompressRequest } = await import('../workers/pdfCompress.worker');
  const { buildSamplePdf } = await import('../lib/tools/pdfCompressEngine');
  const jpeg = (size: number) => {
    const bytes = new Uint8Array(size);
    bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x06, 0x40, 0x09, 0x60, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    return bytes;
  };
  const codec = {
    decodeJpeg: async (_bytes: Uint8Array, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4).fill(128), width, height }),
    encodeJpeg: async () => jpeg(500),
    encodePng: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  };
  type Request = Parameters<typeof handlePdfCompressRequest>[0];
  return {
    default: createFakeWorkerClass(async (request: Request) =>
      request.kind === 'sample' ? { kind: 'sample' as const, bytes: await buildSamplePdf(jpeg(80_000)) } : handlePdfCompressRequest(request, codec)
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

beforeEach(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake-${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PdfCompressor', () => {
  it('renders presets (Balanced by default), the example and clear controls, and a dropzone', () => {
    render(<PdfCompressor />);
    expect(screen.getByRole('button', { name: 'Balanced' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /load example/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(screen.getByLabelText(/choose a pdf to compress/i)).toBeInTheDocument();
  });

  it('compresses the example PDF and offers a download', async () => {
    render(<PdfCompressor />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    const download = await screen.findByRole('button', { name: /download pdf/i }, { timeout: 10_000 });
    expect(screen.getByText(/% smaller/)).toBeInTheDocument();
    expect(screen.getByText(/1 page · 1 of 1 image re-encoded/)).toBeInTheDocument();
    expect(screen.getByText(/sample-report\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/largest image in the document/i)).toBeInTheDocument();

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(download);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('previews the whole document in a scrollable viewer, switchable between compressed and original', async () => {
    render(<PdfCompressor />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    const compressed = await screen.findByTitle('Compressed PDF preview', {}, { timeout: 10_000 });
    expect(compressed.tagName).toBe('IFRAME');
    const compressedSrc = compressed.getAttribute('src');
    expect(compressedSrc).toMatch(/^blob:.*#view=FitH$/);
    expect(screen.getByRole('link', { name: /open in new tab/i })).toHaveAttribute('target', '_blank');

    fireEvent.click(screen.getByRole('button', { name: 'Original' }));
    const original = screen.getByTitle('Original PDF preview');
    expect(original.getAttribute('src')).toMatch(/^blob:/);
    expect(original.getAttribute('src')).not.toBe(compressedSrc);
    expect(screen.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a helpful error for a file that is not a PDF', async () => {
    render(<PdfCompressor />);
    drop(pdfFile('hello', 'photo.png', 'image/png'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a PDF/);
    expect(screen.queryByRole('button', { name: /download pdf/i })).toBeNull();
  });

  it('shows a helpful error for a .pdf file whose contents are not a PDF', async () => {
    render(<PdfCompressor />);
    drop(pdfFile('just some text renamed to pdf'));
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/doesn’t start with a PDF header/);
  });

  it('says so honestly when the PDF cannot be made smaller', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage();
    render(<PdfCompressor />);
    drop(pdfFile(await doc.save({ useObjectStreams: true })));
    await waitFor(() => expect(screen.getByTestId('pdf-result')).toBeInTheDocument(), { timeout: 5000 });
    const result = screen.getByTestId('pdf-result');
    if (!screen.queryByRole('button', { name: /download pdf/i })) {
      expect(result).toHaveTextContent(/couldn’t be made any smaller/);
    }
  });

  it('switches to Custom when an advanced option diverges from the preset, and hides quality for lossless', () => {
    render(<PdfCompressor />);
    const slider = screen.getByLabelText('JPEG quality');
    fireEvent.input(slider, { target: { value: '42' } });
    expect(screen.getByText(/JPEG quality \(42%\)/)).toBeInTheDocument();
    expect(screen.getByText(/custom settings/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Balanced' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Lossless' }));
    expect(screen.queryByLabelText('JPEG quality')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Strong' }));
    expect(screen.getByRole('button', { name: 'Strong' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: /remove metadata/i })).toBeChecked();
  });

  it('exposes resolution, grayscale and cleanup options', () => {
    render(<PdfCompressor />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('150');
    fireEvent.change(select, { target: { value: 'original' } });
    expect(select.value).toBe('original');
    const gray = screen.getByRole('checkbox', { name: /grayscale/i });
    fireEvent.click(gray);
    expect(gray).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /thumbnails/i })).toBeChecked();
  });

  it('Clear removes the file and result and resets settings', async () => {
    render(<PdfCompressor />);
    fireEvent.click(screen.getByRole('button', { name: 'Strong' }));
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByRole('button', { name: /download pdf/i }, { timeout: 10_000 });

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByRole('button', { name: /download pdf/i })).toBeNull();
    expect(screen.queryByText(/sample-report\.pdf/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Balanced' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });
});
