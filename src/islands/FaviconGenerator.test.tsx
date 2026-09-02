import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import FaviconGenerator from './FaviconGenerator';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

class FakeImageBitmap {
  width: number;
  height: number;
  constructor(width = 400, height = 200) {
    this.width = width;
    this.height = height;
  }
  close() {}
}

function makeFakeContext() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    drawImage() {},
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  };
}

function stubCanvasAndDecode({ decodeFails = false, width = 400, height = 200 } = {}) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => (decodeFails ? Promise.reject(new Error('bad image')) : Promise.resolve(new FakeImageBitmap(width, height))))
  );

  const proto = HTMLCanvasElement.prototype;
  vi.spyOn(proto, 'getContext').mockImplementation((() => makeFakeContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(proto, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback) {
    callback(new Blob([new Uint8Array(16)], { type: 'image/png' }));
  });

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake-url'),
    revokeObjectURL: vi.fn(),
  });
}

const dropFile = (file: File) => {
  const dropzone = document.querySelector('.dropzone')!;
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
};

describe('<FaviconGenerator />', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with a dropzone and no output', () => {
    stubCanvasAndDecode();
    render(<FaviconGenerator />);
    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /favicon\.ico/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download all as \.zip/i })).not.toBeInTheDocument();
  });

  it('produces a full favicon package once an image is dropped', async () => {
    stubCanvasAndDecode();
    render(<FaviconGenerator />);
    dropFile(new File([PNG_SIGNATURE], 'logo.png', { type: 'image/png' }));

    expect(await screen.findByRole('button', { name: /favicon\.ico/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FAVICON_FILE_REGEX('favicon-16x16.png') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FAVICON_FILE_REGEX('favicon-32x32.png') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FAVICON_FILE_REGEX('apple-touch-icon.png') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FAVICON_FILE_REGEX('android-chrome-192x192.png') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: FAVICON_FILE_REGEX('android-chrome-512x512.png') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download all as \.zip/i })).toBeEnabled();
  });

  it('shows the preview thumbnails and the HTML snippet once generated', async () => {
    stubCanvasAndDecode();
    render(<FaviconGenerator />);
    dropFile(new File([PNG_SIGNATURE], 'logo.png', { type: 'image/png' }));

    await screen.findByRole('button', { name: /favicon\.ico/i });
    expect(await screen.findByAltText(/32×32 favicon preview/i)).toBeInTheDocument();
    expect(await screen.findByAltText(/180×180 apple-touch-icon preview/i)).toBeInTheDocument();
    expect(screen.getByText(/html to paste into/i)).toBeInTheDocument();
    expect(screen.getByText(/rel="manifest"/i)).toBeInTheDocument();
  });

  it('notes when a non-square source was center-cropped', async () => {
    stubCanvasAndDecode({ width: 400, height: 200 });
    render(<FaviconGenerator />);
    dropFile(new File([PNG_SIGNATURE], 'wide.png', { type: 'image/png' }));

    expect(await screen.findByText(/center-cropped to a square/i)).toBeInTheDocument();
  });

  it('notes when a square source needed no crop', async () => {
    stubCanvasAndDecode({ width: 300, height: 300 });
    render(<FaviconGenerator />);
    dropFile(new File([PNG_SIGNATURE], 'square.png', { type: 'image/png' }));

    expect(await screen.findByText(/already square, no crop needed/i)).toBeInTheDocument();
  });

  it('shows a visible error for a non-image file instead of silently doing nothing', async () => {
    // FileDropzone pre-filters non-image files itself (accept="image/*") before this tool's
    // own validateImageFile ever runs — matching Image Cropper's identical single-file setup.
    stubCanvasAndDecode();
    render(<FaviconGenerator />);
    dropFile(new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't look like an image/i);
    expect(screen.queryByRole('button', { name: /favicon\.ico/i })).not.toBeInTheDocument();
  });

  it('shows a visible error when the browser cannot decode the file', async () => {
    stubCanvasAndDecode({ decodeFails: true });
    render(<FaviconGenerator />);
    dropFile(new File([PNG_SIGNATURE], 'broken.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't read that as an image/i);
  });

  it('loads a generated sample image when "Load example" is pressed', async () => {
    stubCanvasAndDecode();
    render(<FaviconGenerator />);

    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    expect(await screen.findByRole('button', { name: /favicon\.ico/i })).toBeInTheDocument();
  });

  it('clears the image and every generated file, returning to the dropzone', async () => {
    stubCanvasAndDecode();
    render(<FaviconGenerator />);
    dropFile(new File([PNG_SIGNATURE], 'logo.png', { type: 'image/png' }));
    await screen.findByRole('button', { name: /favicon\.ico/i });

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /favicon\.ico/i })).not.toBeInTheDocument();
  });

  it('disables the Clear button until a file is chosen', () => {
    stubCanvasAndDecode();
    render(<FaviconGenerator />);
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });

  it('does not offer a share-link button, since the input is an image file, not text', () => {
    stubCanvasAndDecode();
    render(<FaviconGenerator />);
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });

  it('bundles every generated file plus the manifest into a single zip download', async () => {
    stubCanvasAndDecode();
    render(<FaviconGenerator />);
    dropFile(new File([PNG_SIGNATURE], 'logo.png', { type: 'image/png' }));
    await screen.findByRole('button', { name: /favicon\.ico/i });

    fireEvent.click(screen.getByRole('button', { name: /download all as \.zip/i }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });
});

/** Matches an exact download-button label built from an icon (⭳) plus the filename text. */
function FAVICON_FILE_REGEX(filename: string): RegExp {
  return new RegExp(filename.replace(/\./g, '\\.'), 'i');
}
