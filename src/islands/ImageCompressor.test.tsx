import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import ImageCompressor from './ImageCompressor';

// Real @jsquash/oxipng loads and runs actual WebAssembly, which is unnecessary weight and
// risk for a unit test — this stands in for it, shrinking the buffer by one byte so the
// "the optimizer ran and helped" branch is exercised deterministically.
vi.mock('@jsquash/oxipng', () => ({
  optimise: vi.fn(async (buffer: ArrayBuffer) => buffer.slice(0, Math.max(1, buffer.byteLength - 1))),
}));

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

class FakeImageBitmap {
  width = 200;
  height = 100;
  close() {}
}

class FakeCanvasContext {
  fillStyle = '';
  drawImage() {}
  fillRect() {}
  createLinearGradient() {
    return { addColorStop() {} };
  }
  // Fully opaque by default — matches the common case (no transparency to warn about) so
  // existing tests that never touch this feature aren't affected by the alpha scan the
  // JPEG-from-alpha-capable-source path runs.
  getImageData(_x: number, _y: number, width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4).fill(255) };
  }
}

function stubCanvasAndDecode(outputSize = 42) {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(new FakeImageBitmap()));

  const proto = HTMLCanvasElement.prototype;
  vi.spyOn(proto, 'getContext').mockImplementation(
    (() => new FakeCanvasContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext
  );
  vi.spyOn(proto, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback) {
    callback(new Blob([new Uint8Array(outputSize)], { type: 'image/jpeg' }));
  });

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake-url'),
    revokeObjectURL: vi.fn(),
  });
}

const dropFiles = (files: File[]) => {
  const dropzone = document.querySelector('.dropzone')!;
  fireEvent.drop(dropzone, { dataTransfer: { files } });
};

const jobRows = () => document.querySelectorAll('.job');

describe('<ImageCompressor />', () => {
  beforeEach(() => {
    stubCanvasAndDecode();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with no images and no job list', () => {
    render(<ImageCompressor />);
    expect(screen.getByText(/drag one or more images here/i)).toBeInTheDocument();
    expect(jobRows().length).toBe(0);
    expect(screen.queryByTestId('total-savings')).not.toBeInTheDocument();
  });

  it('updates the dropzone hint to reflect remaining room once images are added', async () => {
    render(<ImageCompressor />);
    const a = new File([PNG_SIGNATURE], 'a.png', { type: 'image/png' });
    const b = new File([PNG_SIGNATURE], 'b.png', { type: 'image/png' });
    dropFiles([a, b]);
    await waitFor(() => expect(jobRows().length).toBe(2));

    expect(screen.queryByText(/drag one or more images here/i)).not.toBeInTheDocument();
    expect(screen.getByText(/drag more images here \(28 more allowed\)/i)).toBeInTheDocument();
  });

  it('shows a prominent total-savings banner once at least one image finishes', async () => {
    render(<ImageCompressor />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    const banner = await screen.findByTestId('total-savings');
    expect(banner).toHaveTextContent(/smaller|larger|no change/i);
    expect(banner).toHaveTextContent(/across 1 image/i);
  });

  it('compresses a dropped image, shows its stats in the row, and its comparison in the auto-selected detail panel', async () => {
    render(<ImageCompressor />);
    const file = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });

    dropFiles([file]);

    await waitFor(() => expect(jobRows().length).toBe(1));
    const row = within(jobRows()[0] as HTMLElement);
    await waitFor(() => expect(row.getByText(/smaller|larger|no change/i)).toBeInTheDocument());
    // Displayed name reflects the *output* format (default JPEG), not the uploaded file's own
    // extension — this is what the row/detail panel will actually download as.
    expect(row.getByText('photo.jpg')).toBeInTheDocument();
    // The single job auto-selects, so its full comparison shows in the detail panel below.
    expect(await screen.findByTestId('selected-job-stats')).toHaveTextContent(/smaller|larger|no change/i);
    expect(screen.getByAltText('Compressed')).toBeInTheDocument();
  });

  it('compresses multiple dropped images into separate job rows', async () => {
    render(<ImageCompressor />);
    const a = new File([PNG_SIGNATURE], 'a.png', { type: 'image/png' });
    const b = new File([PNG_SIGNATURE], 'b.png', { type: 'image/png' });

    dropFiles([a, b]);

    await waitFor(() => expect(jobRows().length).toBe(2));
    expect(within(jobRows()[0] as HTMLElement).getByText('a.jpg')).toBeInTheDocument();
    expect(within(jobRows()[1] as HTMLElement).getByText('b.jpg')).toBeInTheDocument();
  });

  it('switches the detail panel to a different image when its row is selected', async () => {
    render(<ImageCompressor />);
    const a = new File([PNG_SIGNATURE], 'a.png', { type: 'image/png' });
    const b = new File([PNG_SIGNATURE], 'b.png', { type: 'image/png' });
    dropFiles([a, b]);
    await waitFor(() => expect(jobRows().length).toBe(2));

    // "a.jpg" (output name for uploaded a.png) auto-selected first — shows in both the row
    // and the detail panel.
    expect(await screen.findByText('a.jpg', { selector: '.job-detail__filename' })).toBeInTheDocument();

    fireEvent.click(within(jobRows()[1] as HTMLElement).getByRole('button', { name: /^b\.jpg/i }));

    expect(await screen.findByText('b.jpg', { selector: '.job-detail__filename' })).toBeInTheDocument();
    expect(screen.queryByText('a.jpg', { selector: '.job-detail__filename' })).not.toBeInTheDocument();
  });

  it('runs PNG output through the lossless WASM optimizer and still produces a result', async () => {
    render(<ImageCompressor />);
    fireEvent.click(screen.getByRole('button', { name: /^png/i }));
    const file = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });

    dropFiles([file]);

    await waitFor(() => expect(jobRows().length).toBe(1));
    await waitFor(() => expect(within(jobRows()[0] as HTMLElement).getByText(/smaller|larger|no change/i)).toBeInTheDocument());
  });

  it('shows a visible error for a non-image file instead of silently doing nothing', async () => {
    render(<ImageCompressor />);
    const file = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });

    dropFiles([file]);

    expect(await screen.findByRole('alert')).toHaveTextContent(/not an image/i);
  });

  it('rejects an animated GIF with an explanation instead of silently flattening it', async () => {
    render(<ImageCompressor />);
    const file = new File([PNG_SIGNATURE], 'anim.gif', { type: 'image/gif' });

    dropFiles([file]);

    expect(await screen.findByRole('alert')).toHaveTextContent(/animation/i);
  });

  it('rejects SVG and points to the SVG Optimizer tool', async () => {
    render(<ImageCompressor />);
    const file = new File(['<svg></svg>'], 'icon.svg', { type: 'image/svg+xml' });

    dropFiles([file]);

    expect(await screen.findByRole('alert')).toHaveTextContent(/svg optimizer/i);
  });

  it('shows an in-page confirmation before switching output format once images are already added, and respects "cancel"', async () => {
    render(<ImageCompressor />);
    const file = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });
    dropFiles([file]);
    await waitFor(() => expect(jobRows().length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /^png/i }));

    const banner = screen.getByRole('alertdialog', { name: /confirm output format change/i });
    expect(banner).toHaveTextContent(/switch output format to png/i);
    // Still pending — the format button itself hasn't flipped yet.
    expect(screen.getByRole('button', { name: /^png/i })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(banner).getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^png/i })).toHaveAttribute('aria-pressed', 'false');
    expect(within(jobRows()[0] as HTMLElement).getByText('photo.jpg')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^png/i }));
    fireEvent.click(screen.getByRole('button', { name: /^switch to png/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^png/i })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(within(jobRows()[0] as HTMLElement).getByText('photo.png')).toBeInTheDocument());
  });

  it('does not ask for confirmation when switching format before any image is added', () => {
    render(<ImageCompressor />);

    fireEvent.click(screen.getByRole('button', { name: /^png/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^png/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"Keep original format" keeps each image in its own format instead of the fallback, with confirmation once images exist', async () => {
    render(<ImageCompressor />);
    const png = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });
    dropFiles([png]);
    await waitFor(() => expect(jobRows().length).toBe(1));
    // Output format defaults to JPEG, so with the toggle off the row shows the converted name.
    expect(within(jobRows()[0] as HTMLElement).getByText('photo.jpg')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /keep original format/i }));
    const banner = screen.getByRole('alertdialog', { name: /confirm output format change/i });
    expect(banner).toHaveTextContent(/keep each image's own format/i);
    // Still off — pending confirmation.
    expect(screen.getByRole('checkbox', { name: /keep original format/i })).not.toBeChecked();

    fireEvent.click(within(banner).getByRole('button', { name: /^keep original formats$/i }));

    expect(screen.getByRole('checkbox', { name: /keep original format/i })).toBeChecked();
    await waitFor(() => expect(within(jobRows()[0] as HTMLElement).getByText('photo.png')).toBeInTheDocument());
  });

  it('still falls back to the selected format for a type "Keep original format" cannot keep (e.g. BMP)', async () => {
    render(<ImageCompressor />);
    // Turn the toggle on first, while the batch is empty, so it applies without confirmation.
    fireEvent.click(screen.getByRole('checkbox', { name: /keep original format/i }));
    expect(screen.getByRole('checkbox', { name: /keep original format/i })).toBeChecked();

    const bmp = new File([PNG_SIGNATURE], 'photo.bmp', { type: 'image/bmp' });
    dropFiles([bmp]);
    await waitFor(() => expect(jobRows().length).toBe(1));

    // BMP isn't one of the three formats this tool can encode, so it still falls back to the
    // selected output format (default JPEG) rather than "keeping" an unsupported format.
    await waitFor(() => expect(within(jobRows()[0] as HTMLElement).getByText('photo.jpg')).toBeInTheDocument());
  });

  it('cancelling a "Keep original format" toggle leaves it unchanged', async () => {
    render(<ImageCompressor />);
    const png = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });
    dropFiles([png]);
    await waitFor(() => expect(jobRows().length).toBe(1));

    fireEvent.click(screen.getByRole('checkbox', { name: /keep original format/i }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /keep original format/i })).not.toBeChecked();
    expect(within(jobRows()[0] as HTMLElement).getByText('photo.jpg')).toBeInTheDocument();
  });

  it('lets one image lock to its own format via the per-row lock button, applied immediately with no confirmation', async () => {
    render(<ImageCompressor />);
    const png = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });
    dropFiles([png]);
    await waitFor(() => expect(jobRows().length).toBe(1));
    expect(within(jobRows()[0] as HTMLElement).getByText('photo.jpg')).toBeInTheDocument();

    const lockButton = screen.getByRole('button', { name: /lock photo\.png to png/i });
    expect(lockButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(lockButton);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /photo\.png is locked to png/i })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(within(jobRows()[0] as HTMLElement).getByText('photo.png')).toBeInTheDocument());
  });

  it('does not offer the per-row lock button once the batch-wide toggle already keeps original formats', async () => {
    render(<ImageCompressor />);
    fireEvent.click(screen.getByRole('checkbox', { name: /^keep original format$/i }));
    const png = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });
    dropFiles([png]);
    await waitFor(() => expect(jobRows().length).toBe(1));

    expect(screen.queryByRole('button', { name: /lock photo\.png to png/i })).not.toBeInTheDocument();
  });

  it('warns when converting a transparent image to JPEG', async () => {
    render(<ImageCompressor />);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => ({
        fillStyle: '',
        drawImage() {},
        fillRect() {},
        createLinearGradient: () => ({ addColorStop() {} }),
        getImageData(_x: number, _y: number, width: number, height: number) {
          const data = new Uint8ClampedArray(width * height * 4).fill(255);
          data[3] = 0; // first pixel fully transparent
          return { data };
        },
      })) as unknown as typeof HTMLCanvasElement.prototype.getContext
    );
    const transparentPng = new File([PNG_SIGNATURE], 'icon.png', { type: 'image/png' });

    dropFiles([transparentPng]);

    await waitFor(() => expect(screen.getByText(/transparency was lost/i)).toBeInTheDocument());
  });

  it('does not warn about transparency for an opaque image converted to JPEG', async () => {
    // stubCanvasAndDecode() (from beforeEach) already mocks getImageData as fully opaque.
    render(<ImageCompressor />);
    const opaquePng = new File([PNG_SIGNATURE], 'flat.png', { type: 'image/png' });

    dropFiles([opaquePng]);

    await waitFor(() => expect(screen.getByTestId('selected-job-stats')).toBeInTheDocument());
    expect(screen.queryByText(/transparency was lost/i)).not.toBeInTheDocument();
  });

  it('shows a quality slider next to the preview for JPEG but not for lossless PNG output', async () => {
    render(<ImageCompressor />);
    const file = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });
    dropFiles([file]);
    await waitFor(() => expect(screen.getByTestId('selected-job-stats')).toBeInTheDocument());

    expect(screen.getByLabelText(/^quality$/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^png/i }));
    fireEvent.click(screen.getByRole('button', { name: /^switch to png/i }));

    // The stale JPEG result (and its Quality slider) keeps showing while PNG re-compression
    // runs in the background, so wait for the slider to actually disappear rather than just
    // for the (already-present, still-stale) stats block.
    await waitFor(() => expect(screen.queryByLabelText(/^quality$/i)).not.toBeInTheDocument());
  });

  it('loads a generated sample image when "Load example" is pressed', async () => {
    render(<ImageCompressor />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    await waitFor(() => expect(jobRows().length).toBe(1));
    await waitFor(() => expect(within(jobRows()[0] as HTMLElement).getByText(/smaller|larger|no change/i)).toBeInTheDocument());
  });

  it('removes a single image from the batch without clearing the rest', async () => {
    render(<ImageCompressor />);
    const a = new File([PNG_SIGNATURE], 'a.png', { type: 'image/png' });
    const b = new File([PNG_SIGNATURE], 'b.png', { type: 'image/png' });
    dropFiles([a, b]);
    await waitFor(() => expect(jobRows().length).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: /remove a\.png/i }));

    expect(jobRows().length).toBe(1);
    expect(screen.queryByText('a.jpg')).not.toBeInTheDocument();
    expect(within(jobRows()[0] as HTMLElement).getByText('b.jpg')).toBeInTheDocument();
  });

  it('clears every image and resets settings when Clear is pressed', async () => {
    render(<ImageCompressor />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));
    await waitFor(() => expect(jobRows().length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(jobRows().length).toBe(0);
    expect(screen.getByText(/drag one or more images here/i)).toBeInTheDocument();
  });

  it('only shows "Download all" once at least one image has finished compressing', async () => {
    render(<ImageCompressor />);
    expect(screen.queryByRole('button', { name: /download all/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /download all \(1\)/i })).not.toBeDisabled());
  });

  it('does not offer a share-link button, since the input is a set of files, not text', () => {
    render(<ImageCompressor />);
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });

  it('shows each image its own original dimensions and lets Max dimension be set independently per image', async () => {
    render(<ImageCompressor />);
    const a = new File([PNG_SIGNATURE], 'a.png', { type: 'image/png' });
    const b = new File([PNG_SIGNATURE], 'b.png', { type: 'image/png' });
    dropFiles([a, b]);
    await waitFor(() => expect(jobRows().length).toBe(2));
    await waitFor(() => expect(screen.getByTestId('selected-job-stats')).toBeInTheDocument());

    // a.png (200x100, from FakeImageBitmap) is auto-selected — its original size shows next
    // to the Max dimension field, and the field itself starts blank (no limit).
    expect(await screen.findByText(/original 200×100/i)).toBeInTheDocument();
    const dimInput = screen.getByLabelText(/maximum dimension in pixels for a\.png/i) as HTMLInputElement;
    expect(dimInput.value).toBe('');

    fireEvent.input(dimInput, { target: { value: '100' } });
    await waitFor(() => expect(screen.getByTestId('selected-job-stats')).toHaveTextContent(/smaller|larger|no change/i));

    // Switching to b.png shows *its* own (still blank) Max dimension, not a.png's '100'.
    fireEvent.click(within(jobRows()[1] as HTMLElement).getByRole('button', { name: /^b\.jpg/i }));
    await waitFor(() => expect(screen.getByLabelText(/maximum dimension in pixels for b\.png/i)).toBeInTheDocument());
    expect((screen.getByLabelText(/maximum dimension in pixels for b\.png/i) as HTMLInputElement).value).toBe('');
  });

  it('caps a batch at the maximum file count and reports how many were skipped', async () => {
    render(<ImageCompressor />);
    const files = Array.from({ length: 32 }, (_, i) => new File([PNG_SIGNATURE], `img-${i}.png`, { type: 'image/png' }));

    dropFiles(files);

    expect(await screen.findByRole('alert')).toHaveTextContent(/only 30 images/i);
    expect(jobRows().length).toBe(30);
  });
});
