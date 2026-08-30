import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import ImageCropper from './ImageCropper';

/** Scoped to the result panel, since the "Lossy (smaller)" mode button's own label also
 *  contains the word "smaller" — an unscoped `getByText` would match both once PNG's mode
 *  toggle is visible. */
const resultStats = () => within(document.querySelector('.crop-result__stats') as HTMLElement);

// Real @jsquash/oxipng loads and runs actual WebAssembly — stand in for it so PNG output
// tests stay fast and deterministic, matching the Image Compressor's test setup.
vi.mock('@jsquash/oxipng', () => ({
  optimise: vi.fn(async (buffer: ArrayBuffer) => buffer.slice(0, Math.max(1, buffer.byteLength - 1))),
}));

// Real image-q runs a genuine quantization algorithm — deterministic but unnecessary work
// for a component test, which only needs to know the quantizer was (or wasn't) invoked.
// This stand-in returns the input pixels untouched so tests can assert on call counts.
// Declared via vi.hoisted since vi.mock's factory below is itself hoisted above normal
// top-level statements, and would otherwise run before a plain `const` was initialized.
const { quantizeSpy } = vi.hoisted(() => ({
  quantizeSpy: vi.fn(async (image: { data: Uint8ClampedArray; width: number; height: number }) => image),
}));
vi.mock('../lib/tools/imageCompress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tools/imageCompress')>();
  return { ...actual, quantizePngPixels: quantizeSpy };
});

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

class FakeImageBitmap {
  width = 400;
  height = 200;
  close() {}
}

class FakeCanvasContext {
  fillStyle = '';
  drawImage() {}
  fillRect() {}
  beginPath() {}
  arc() {}
  fill() {}
  getImageData(_x: number, _y: number, width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4).fill(255), width, height };
  }
  putImageData() {}
}

// jsdom doesn't implement the `ImageData` constructor at all — only real browsers do — so
// the PNG-lossy path's `new ImageData(...)` call needs a stand-in, the same way createImageBitmap
// and canvas itself are stubbed below.
class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

function stubCanvasAndDecode() {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(new FakeImageBitmap()));
  vi.stubGlobal('ImageData', FakeImageData);

  const proto = HTMLCanvasElement.prototype;
  vi.spyOn(proto, 'getContext').mockImplementation(
    (() => new FakeCanvasContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext
  );
  vi.spyOn(proto, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback) {
    callback(new Blob([new Uint8Array(24)], { type: 'image/jpeg' }));
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

describe('<ImageCropper />', () => {
  beforeEach(() => {
    stubCanvasAndDecode();
    quantizeSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with a dropzone and no crop UI', () => {
    render(<ImageCropper />);
    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
    expect(screen.queryByText(/^x$/i)).not.toBeInTheDocument();
  });

  it('shows the crop UI with a full-image default selection once an image loads', async () => {
    render(<ImageCropper />);
    const file = new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' });
    dropFile(file);

    expect(await screen.findByText(/400×200px/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/^x$/i) as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText(/^y$/i) as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText(/^width$/i) as HTMLInputElement).value).toBe('400');
    expect((screen.getByLabelText(/^height$/i) as HTMLInputElement).value).toBe('200');
  });

  it('produces a cropped result with a compare slider and a download button', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/400×200px/i);

    await waitFor(() => expect(screen.getByText(/smaller|larger|no change/i)).toBeInTheDocument());
    expect(screen.getByText(/→/)).toBeInTheDocument();
    expect(screen.getByAltText('Cropped')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
  });

  it('shows the original file size next to the image dimensions', async () => {
    render(<ImageCropper />);
    const file = new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' });
    dropFile(file);

    expect(await screen.findByText(new RegExp(`${file.size} B original`))).toBeInTheDocument();
  });

  it('applies a 1:1 aspect preset by shrinking the wider dimension to match', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/400×200px/i);

    fireEvent.click(screen.getByRole('button', { name: '1:1' }));

    await waitFor(() => expect((screen.getByLabelText(/^width$/i) as HTMLInputElement).value).toBe('200'));
    expect((screen.getByLabelText(/^height$/i) as HTMLInputElement).value).toBe('200');
  });

  it('resets the crop back to the full image', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/400×200px/i);

    fireEvent.click(screen.getByRole('button', { name: '1:1' }));
    await waitFor(() => expect((screen.getByLabelText(/^width$/i) as HTMLInputElement).value).toBe('200'));

    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect((screen.getByLabelText(/^width$/i) as HTMLInputElement).value).toBe('400');
    expect((screen.getByLabelText(/^height$/i) as HTMLInputElement).value).toBe('200');
  });

  it('edits the crop rectangle directly via the numeric fields', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/400×200px/i);

    fireEvent.input(screen.getByLabelText(/^width$/i), { target: { value: '150' } });
    expect((screen.getByLabelText(/^width$/i) as HTMLInputElement).value).toBe('150');
  });

  it('reveals resize fields pre-filled with the crop size when "Resize output" is enabled', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/400×200px/i);

    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));

    expect((screen.getByLabelText(/width \(px\)/i) as HTMLInputElement).value).toBe('400');
    expect((screen.getByLabelText(/height \(px\)/i) as HTMLInputElement).value).toBe('200');
  });

  it('keeps resize width/height in sync when aspect ratio is locked', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/400×200px/i);
    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));
    expect(screen.getByRole('checkbox', { name: /lock aspect ratio/i })).toBeChecked();

    fireEvent.input(screen.getByLabelText(/width \(px\)/i), { target: { value: '200' } });

    expect((screen.getByLabelText(/height \(px\)/i) as HTMLInputElement).value).toBe('100');
  });

  it('leaves the other resize dimension alone when aspect ratio is unlocked', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/400×200px/i);
    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /lock aspect ratio/i }));

    fireEvent.input(screen.getByLabelText(/width \(px\)/i), { target: { value: '200' } });

    expect((screen.getByLabelText(/height \(px\)/i) as HTMLInputElement).value).toBe('200');
  });

  it('shows a quality slider for a lossy format but not for lossless PNG', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/400×200px/i);

    expect(screen.getByLabelText(/^quality$/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^png/i }));
    await waitFor(() => expect(screen.queryByLabelText(/^quality$/i)).not.toBeInTheDocument());
  });

  it('shows a visible error for a non-image file instead of silently doing nothing', async () => {
    render(<ImageCropper />);
    dropFile(new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't look like an image/i);
  });

  it('loads a generated sample image with a demo crop when "Load example" is pressed', async () => {
    render(<ImageCropper />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    await screen.findByText(/400×200px/i);
    expect((screen.getByLabelText(/^width$/i) as HTMLInputElement).value).not.toBe('0');
    expect(screen.getByRole('checkbox', { name: /resize output/i })).toBeChecked();
  });

  it('clears the image and returns to the dropzone', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/400×200px/i);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
    expect(screen.queryByText(/original$/i)).not.toBeInTheDocument();
  });

  it('does not offer a share-link button, since the input is an image file, not text', () => {
    render(<ImageCropper />);
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });

  it('only shows the PNG compression mode toggle when PNG is the selected output format', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/400×200px/i);
    expect(screen.queryByRole('group', { name: /png compression mode/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^png/i }));

    expect(screen.getByRole('group', { name: /png compression mode/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^jpeg/i }));

    expect(screen.queryByRole('group', { name: /png compression mode/i })).not.toBeInTheDocument();
  });

  it('defaults PNG to lossless (no quantizer call), and switching to Lossy mode quantizes and still produces a result', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' }));
    await screen.findByText(/400×200px/i);
    await waitFor(() => expect(resultStats().getByText(/smaller|larger|no change/i)).toBeInTheDocument());

    expect(quantizeSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^lossy \(smaller\)$/i }));

    await waitFor(() => expect(quantizeSpy).toHaveBeenCalled());
    await waitFor(() => expect(resultStats().getByText(/smaller|larger|no change/i)).toBeInTheDocument());

    quantizeSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^lossless$/i }));
    await waitFor(() => expect(resultStats().getByText(/smaller|larger|no change/i)).toBeInTheDocument());
    expect(quantizeSpy).not.toHaveBeenCalled();
  });

  it('shows a "Colors" label instead of "Quality" once PNG Lossy mode is on', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' }));
    await screen.findByText(/400×200px/i);
    expect(screen.queryByLabelText(/^quality$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^lossy \(smaller\)$/i }));

    await waitFor(() => expect(screen.getByLabelText(/^quality$/i)).toBeInTheDocument());
    expect(screen.getByText(/^colors \(~\d+\)$/i)).toBeInTheDocument();
  });

  it('resets PNG mode back to lossless when a new file is loaded', async () => {
    render(<ImageCropper />);
    dropFile(new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' }));
    await screen.findByText(/400×200px/i);
    fireEvent.click(screen.getByRole('button', { name: /^lossy \(smaller\)$/i }));
    expect(screen.getByRole('button', { name: /^lossy \(smaller\)$/i })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    dropFile(new File([PNG_SIGNATURE], 'photo2.png', { type: 'image/png' }));
    await screen.findByText(/400×200px/i);

    expect(screen.getByRole('button', { name: /^lossless$/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
