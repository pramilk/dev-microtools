import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import ImageToPdf from './ImageToPdf';

// jsdom has no Worker, canvas or createImageBitmap. The mocked worker runs the real request
// handler (so the real pdf-lib engine builds the PDF) with a fake decoder, and serves "Load
// example" with minimal JPEG/PNG stand-ins instead of canvas-drawn images.
vi.mock('../workers/imageToPdf.worker?worker', async () => {
  const { createFakeWorkerClass } = await import('../../test/fakeWorker');
  const { handleImageToPdfRequest } = await import('../workers/imageToPdf.worker');
  const { withExifOrientation } = await import('../lib/tools/imageToPdf');
  const jpeg = (width: number, height: number) => {
    const bytes = new Uint8Array(300);
    bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    return bytes;
  };
  const codec = {
    decodeImage: async (bytes: Uint8Array) => {
      if (bytes[0] !== 0x89) throw new Error('cannot decode');
      return { data: new Uint8ClampedArray(30 * 20 * 4).fill(255), width: 30, height: 20 };
    },
    encodeJpeg: async () => jpeg(30, 20),
  };
  type Request = Parameters<typeof handleImageToPdfRequest>[0];
  return {
    default: createFakeWorkerClass(async (request: Request) =>
      request.kind === 'samples'
        ? {
            kind: 'samples' as const,
            files: [
              { name: '01-landscape-photo.jpg', type: 'image/jpeg', bytes: jpeg(1600, 1067) },
              { name: '02-sales-chart.png', type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
              { name: '03-receipt-phone-photo.jpg', type: 'image/jpeg', bytes: withExifOrientation(jpeg(1200, 800), 6) },
            ],
          }
        : handleImageToPdfRequest(request, codec)
    ),
  };
});

const imageFile = (name: string, bytes: Uint8Array | string = new Uint8Array([0x89, 0x50, 0x4e, 0x47]), type = 'image/png') =>
  new File([typeof bytes === 'string' ? bytes : (bytes as Uint8Array<ArrayBuffer>)], name, { type });

function chooseFiles(files: File[]) {
  fireEvent.change(screen.getByLabelText(/choose images to convert to pdf/i), { target: { files } });
}

const rowNames = () => screen.getAllByTestId('image-row').map((row) => row.querySelector('.imgpdf-row__name')?.textContent);

async function loadExample() {
  fireEvent.click(screen.getByRole('button', { name: /load example/i }));
  return screen.findByTestId('image-pdf-result', {}, { timeout: 10_000 });
}

beforeEach(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake-${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ImageToPdf', () => {
  it('renders the dropzone, example and clear controls, with Clear disabled when empty', () => {
    render(<ImageToPdf />);
    expect(screen.getByText(/drag one or more images here/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load example/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });

  it('builds the example into a PDF with a preview and download', async () => {
    render(<ImageToPdf />);
    const result = await loadExample();
    expect(rowNames()).toEqual(['01-landscape-photo.jpg', '02-sales-chart.png', '03-receipt-phone-photo.jpg']);
    expect(result).toHaveTextContent(/3 pages/);
    expect(result).toHaveTextContent(/2 JPEGs embedded as-is \(no quality loss\) · 1 image stored losslessly/);
    expect(result).toHaveTextContent(/1 photo turned upright/);
    expect(screen.getByTitle('PDF preview')).toHaveAttribute('src', expect.stringMatching(/^blob:/));

    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    fireEvent.input(screen.getByRole('textbox', { name: /file name for the pdf/i }), { target: { value: 'My receipts' } });
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    expect(downloads).toEqual(['My receipts.pdf']);
  });

  it('reorders with the arrow buttons and sorts by name', async () => {
    render(<ImageToPdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: /move 01-landscape-photo\.jpg down/i }));
    expect(rowNames()).toEqual(['02-sales-chart.png', '01-landscape-photo.jpg', '03-receipt-phone-photo.jpg']);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /move 01-landscape-photo\.jpg down/i })));

    fireEvent.click(screen.getByRole('button', { name: /sort z–a/i }));
    expect(rowNames()).toEqual(['03-receipt-phone-photo.jpg', '02-sales-chart.png', '01-landscape-photo.jpg']);
    fireEvent.click(screen.getByRole('button', { name: /sort a–z/i }));
    expect(rowNames()[0]).toBe('01-landscape-photo.jpg');
  });

  it('rotates an image and rebuilds the PDF', async () => {
    render(<ImageToPdf />);
    await loadExample();
    const before = screen.getByTitle('PDF preview').getAttribute('src');
    const rotate = screen.getByRole('button', { name: /rotate 02-sales-chart\.png — currently 0°/i });
    fireEvent.click(rotate);
    expect(screen.getByRole('button', { name: /rotate 02-sales-chart\.png — currently 90°/i })).toHaveTextContent('↻ 90°');
    await waitFor(() => expect(screen.getByTitle('PDF preview').getAttribute('src')).not.toBe(before), { timeout: 5000 });
  });

  it('changes page options, disabling orientation for "Fit to image"', async () => {
    render(<ImageToPdf />);
    await loadExample();
    expect(screen.getByRole('button', { name: 'A4' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Fit to image' }));
    expect(screen.getByRole('button', { name: 'Auto' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Large' }));
    expect(screen.getByRole('button', { name: 'Large' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('rejects non-images and SVG with a visible error, but keeps the valid files', () => {
    render(<ImageToPdf />);
    chooseFiles([imageFile('notes.txt', 'hello', 'text/plain'), imageFile('logo.svg', '<svg/>', 'image/svg+xml'), imageFile('ok.png')]);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/notes\.txt.*isn't an image/);
    expect(alert).toHaveTextContent(/logo\.svg.*SVG/);
    expect(rowNames()).toEqual(['ok.png']);
  });

  it('flags an image that can’t be decoded and builds the PDF from the rest', async () => {
    render(<ImageToPdf />);
    chooseFiles([imageFile('IMG_0001.heic', new Uint8Array([0, 0, 0, 0x18]), 'image/heic'), imageFile('ok.png')]);
    const result = await screen.findByTestId('image-pdf-result', {}, { timeout: 5000 });
    expect(result).toHaveTextContent(/1 page/);
    expect(result).toHaveTextContent(/1 image couldn’t be read/);
    const [heicRow] = screen.getAllByTestId('image-row');
    expect(within(heicRow).getByText(/Left out: HEIC/)).toBeInTheDocument();
  });

  it('shows the worker’s error when no image can be read', async () => {
    render(<ImageToPdf />);
    chooseFiles([imageFile('broken.webp', 'not an image', 'image/webp')]);
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/couldn’t be decoded/);
    expect(screen.queryByTestId('image-pdf-result')).toBeNull();
  });

  it('removes an image, and Clear empties everything and resets options', async () => {
    render(<ImageToPdf />);
    await loadExample();
    fireEvent.click(screen.getByRole('button', { name: /remove 02-sales-chart\.png/i }));
    expect(rowNames()).toEqual(['01-landscape-photo.jpg', '03-receipt-phone-photo.jpg']);
    fireEvent.click(screen.getByRole('button', { name: 'Letter' }));

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryAllByTestId('image-row')).toHaveLength(0);
    await waitFor(() => expect(screen.queryByTestId('image-pdf-result')).toBeNull());
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
