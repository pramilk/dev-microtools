import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import ImageFormatConverter from './ImageFormatConverter';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

class FakeImageBitmap {
  width = 64;
  height = 32;
  close() {}
}

function makeFakeContext(opaque = true) {
  return {
    fillStyle: '',
    drawImage() {},
    beginPath() {},
    arc() {},
    fill() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData(_x: number, _y: number, width: number, height: number) {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      if (!opaque) data[3] = 0; // first pixel fully transparent
      return { data };
    },
  };
}

function stubCanvasAndDecode({ opaque = true, decodeFails = false } = {}) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => (decodeFails ? Promise.reject(new Error('bad image')) : Promise.resolve(new FakeImageBitmap())))
  );

  const proto = HTMLCanvasElement.prototype;
  vi.spyOn(proto, 'getContext').mockImplementation((() => makeFakeContext(opaque)) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(proto, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback, type?: string) {
    callback(new Blob([new Uint8Array(16)], { type: type ?? 'image/png' }));
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

describe('<ImageFormatConverter />', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with no images and no job list', () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    expect(screen.getByText(/drag one or more images here \(up to 30 at once\)/i)).toBeInTheDocument();
    expect(jobRows().length).toBe(0);
    expect(screen.queryByTestId('total-savings')).not.toBeInTheDocument();
  });

  it('converts a dropped image to the default PNG target, shown in its row and the auto-selected detail panel', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    const file = new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' });

    dropFiles([file]);

    await waitFor(() => expect(jobRows().length).toBe(1));
    const row = within(jobRows()[0] as HTMLElement);
    await waitFor(() => expect(row.getByText(/smaller|larger|no change/i)).toBeInTheDocument());
    expect(row.getByText('photo.png')).toBeInTheDocument();
    expect(await screen.findByTestId('selected-job-stats')).toHaveTextContent(/smaller|larger|no change/i);
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.getByText('Converted')).toBeInTheDocument();
  });

  it('converts multiple dropped images into separate job rows', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    const a = new File([PNG_SIGNATURE], 'a.jpg', { type: 'image/jpeg' });
    const b = new File([PNG_SIGNATURE], 'b.jpg', { type: 'image/jpeg' });

    dropFiles([a, b]);

    await waitFor(() => expect(jobRows().length).toBe(2));
    expect(within(jobRows()[0] as HTMLElement).getByText('a.png')).toBeInTheDocument();
    expect(within(jobRows()[1] as HTMLElement).getByText('b.png')).toBeInTheDocument();
  });

  it('switches the detail panel to a different image when its row is selected', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    const a = new File([PNG_SIGNATURE], 'a.jpg', { type: 'image/jpeg' });
    const b = new File([PNG_SIGNATURE], 'b.jpg', { type: 'image/jpeg' });
    dropFiles([a, b]);
    await waitFor(() => expect(jobRows().length).toBe(2));

    expect(await screen.findByText('a.png', { selector: '.job-detail__filename' })).toBeInTheDocument();

    fireEvent.click(within(jobRows()[1] as HTMLElement).getByRole('button', { name: /^b\.png/i }));

    expect(await screen.findByText('b.png', { selector: '.job-detail__filename' })).toBeInTheDocument();
    expect(screen.queryByText('a.png', { selector: '.job-detail__filename' })).not.toBeInTheDocument();
  });

  it('shows a quality slider for JPEG and WebP but not for PNG, BMP, or ICO, once images exist', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    const file = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });
    dropFiles([file]);
    await waitFor(() => expect(jobRows().length).toBe(1));

    expect(screen.queryByLabelText(/^quality$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^jpeg$/i }));
    expect(await screen.findByLabelText(/^quality$/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^bmp$/i }));
    await waitFor(() => expect(screen.queryByLabelText(/^quality$/i)).not.toBeInTheDocument());
  });

  it('shows an ICO-specific size-cap hint only when ICO is the target and images exist', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    expect(screen.queryByText(/capped at 256×256px/i)).not.toBeInTheDocument();

    const file = new File([PNG_SIGNATURE], 'photo.png', { type: 'image/png' });
    dropFiles([file]);
    await waitFor(() => expect(jobRows().length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /^ico$/i }));
    expect(await screen.findByText(/capped at 256×256px/i)).toBeInTheDocument();
  });

  it('shows a visible error for a non-image file instead of silently doing nothing', async () => {
    // Unlike the single-file FileDropzone, MultiFileDropzone doesn't pre-filter by type — an
    // invalid file still becomes a job row, which then lands in an error state via this
    // tool's own validateImageFile (matching Image Compressor's identical behavior).
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    const file = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });

    dropFiles([file]);

    expect(await screen.findByRole('alert')).toHaveTextContent(/not an image/i);
  });

  it('shows a visible error when the browser cannot decode the file', async () => {
    stubCanvasAndDecode({ decodeFails: true });
    render(<ImageFormatConverter />);
    const file = new File([PNG_SIGNATURE], 'broken.png', { type: 'image/png' });

    dropFiles([file]);

    await waitFor(() => expect(jobRows().length).toBe(1));
    expect(await screen.findByText(/error/i, { selector: '.job__error-flag' })).toBeInTheDocument();
  });

  it('warns (without blocking) that only the first frame of a GIF converts', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    const file = new File([PNG_SIGNATURE], 'anim.gif', { type: 'image/gif' });

    dropFiles([file]);

    expect(await screen.findByText(/first frame/i)).toBeInTheDocument();
    // Non-blocking — it still converts and offers a download.
    await waitFor(() => expect(within(jobRows()[0] as HTMLElement).getByRole('button', { name: /^download$/i })).toBeInTheDocument());
  });

  it('warns when converting a transparent image to JPEG, and does not for an opaque one', async () => {
    stubCanvasAndDecode({ opaque: false });
    render(<ImageFormatConverter />);
    const file = new File([PNG_SIGNATURE], 'icon.png', { type: 'image/png' });
    dropFiles([file]);
    await waitFor(() => expect(jobRows().length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /^jpeg$/i }));

    expect(await screen.findByText(/transparency was lost/i)).toBeInTheDocument();
  });

  it('does not warn about transparency for an opaque image converted to JPEG', async () => {
    stubCanvasAndDecode({ opaque: true });
    render(<ImageFormatConverter />);
    const file = new File([PNG_SIGNATURE], 'flat.png', { type: 'image/png' });
    dropFiles([file]);
    await waitFor(() => expect(jobRows().length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /^jpeg$/i }));

    await screen.findByTestId('selected-job-stats');
    expect(screen.queryByText(/transparency was lost/i)).not.toBeInTheDocument();
  });

  it('loads a generated sample image when "Load example" is pressed', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);

    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    await waitFor(() => expect(jobRows().length).toBe(1));
    await waitFor(() => expect(within(jobRows()[0] as HTMLElement).getByText(/smaller|larger|no change/i)).toBeInTheDocument());
  });

  it('removes a single image from the batch without clearing the rest', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    const a = new File([PNG_SIGNATURE], 'a.png', { type: 'image/png' });
    const b = new File([PNG_SIGNATURE], 'b.png', { type: 'image/png' });
    dropFiles([a, b]);
    await waitFor(() => expect(jobRows().length).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: /remove a\.png/i }));

    expect(jobRows().length).toBe(1);
    expect(within(jobRows()[0] as HTMLElement).getByText('b.png')).toBeInTheDocument();
  });

  it('clears every image and resets settings when Clear is pressed', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));
    await waitFor(() => expect(jobRows().length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(jobRows().length).toBe(0);
    expect(screen.getByText(/drag one or more images here/i)).toBeInTheDocument();
  });

  it('only shows "Download all" once at least one image has finished converting', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    expect(screen.queryByRole('button', { name: /download all/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /download all \(1\)/i })).not.toBeDisabled());
  });

  it('caps a batch at the maximum file count and reports how many were skipped', async () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    const files = Array.from({ length: 32 }, (_, i) => new File([PNG_SIGNATURE], `img-${i}.png`, { type: 'image/png' }));

    dropFiles(files);

    expect(await screen.findByRole('alert')).toHaveTextContent(/only 30 images/i);
    expect(jobRows().length).toBe(30);
  });

  it('does not offer a share-link button, since the input is a set of files, not text', () => {
    stubCanvasAndDecode();
    render(<ImageFormatConverter />);
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });
});
