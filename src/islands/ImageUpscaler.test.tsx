import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { createFakeWorkerClass } from '../../test/fakeWorker';
import { handleImageUpscaleRequest } from '../workers/imageUpscale.worker';
import { handleImageCompressRequest } from '../workers/imageCompress.worker';
import ImageUpscaler from './ImageUpscaler';

// jsdom has no real Worker; this runs the real request-handling logic (the actual Lanczos
// resample, and the real Oxipng/image-q PNG passes below) synchronously.
vi.mock('../workers/imageUpscale.worker?worker', () => ({
  default: createFakeWorkerClass(handleImageUpscaleRequest),
}));
vi.mock('../workers/imageCompress.worker?worker', () => ({
  default: createFakeWorkerClass(handleImageCompressRequest),
}));

// Real @jsquash/oxipng loads and runs actual WebAssembly — stand in for it so tests stay
// fast and deterministic, matching every other image tool's own test setup. Gated behind a
// mutable, normally-already-resolved promise so one specific test below can hold this pass
// open deliberately, to prove the "Updating…" indicator actually spans it — every other test
// sees it resolve instantly, same as before.
const { gateHolder } = vi.hoisted(() => ({ gateHolder: { promise: Promise.resolve() } }));
vi.mock('@jsquash/oxipng', () => ({
  optimise: vi.fn(async (buffer: ArrayBuffer) => {
    await gateHolder.promise;
    return buffer.slice(0, Math.max(1, buffer.byteLength - 1));
  }),
}));

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

class FakeImageBitmap {
  width = 20;
  height = 10;
  close() {}
}

class FakeCanvasContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  textBaseline = '';
  drawImage() {}
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  stroke() {}
  fillText() {}
  getImageData(_x: number, _y: number, width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4).fill(120), width, height };
  }
  putImageData() {}
}

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
  vi.spyOn(proto, 'getContext').mockImplementation((() => new FakeCanvasContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(proto, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback) {
    callback(new Blob([new Uint8Array(24)], { type: 'image/jpeg' }));
  });

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake-url'),
    revokeObjectURL: vi.fn(),
  });

  // "Load example" fetches a real bundled sample photo rather than generating one — stood in
  // so the test doesn't depend on a real network request or the dev/build server.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob([new Uint8Array(24)], { type: 'image/jpeg' })) })
  );
}

const dropFile = (file: File) => {
  const dropzone = document.querySelector('.dropzone')!;
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
};

describe('<ImageUpscaler />', () => {
  beforeEach(() => {
    stubCanvasAndDecode();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with a dropzone and no multiplier controls visible only after a file loads', () => {
    render(<ImageUpscaler />);
    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
    expect(screen.queryByText(/40×20px/)).not.toBeInTheDocument();
  });

  it('defaults to 4x and shows the projected output size once an image loads', async () => {
    render(<ImageUpscaler />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByText(/20×10px.*→.*80×40px/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4×' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('produces an upscaled result with a compare slider and a working download button', async () => {
    render(<ImageUpscaler />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/20×10px.*→.*80×40px/);

    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument());
    expect(screen.getByText('20 × 10 px')).toBeInTheDocument();
    expect(screen.getByText('80 × 40 px')).toBeInTheDocument();
  });

  it('switching to 2x re-runs the upscale and shows the new projected size', async () => {
    render(<ImageUpscaler />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/20×10px.*→.*80×40px/);
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '2×' }));

    expect(await screen.findByText(/20×10px.*→.*40×20px/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('40 × 20 px')).toBeInTheDocument());
  });

  it('keeps the "Updating…" indicator visible through the PNG optimize pass, not just the resample', async () => {
    // Regression test: the resample and the re-encode (which for PNG runs a real Oxipng
    // pass) used to share one "busy" flag, so it flipped off as soon as the resample
    // finished even though the encode was still running — leaving the stale result on
    // screen with no indicator that anything was still happening.
    let release!: () => void;
    gateHolder.promise = new Promise<void>((resolve) => {
      release = resolve;
    });

    render(<ImageUpscaler />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^png$/i }));
    expect(await screen.findByText(/updating/i)).toBeInTheDocument();

    release();
    await waitFor(() => expect(screen.queryByText(/updating/i)).not.toBeInTheDocument());
  });

  it('shows a clear error for a non-image file instead of a raw stack trace', async () => {
    render(<ImageUpscaler />);
    dropFile(new File(['not an image'], 'notes.txt', { type: 'text/plain' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't look like an image/i);
  });

  it('"Load example" loads a bundled sample photo without any file of the user\'s own', async () => {
    render(<ImageUpscaler />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(await screen.findByText(/cat-sample\.jpg/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/samples/upscaler-sample.jpg');
  });

  it('clear removes the file and returns to the dropzone', async () => {
    render(<ImageUpscaler />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByText(/20×10px/);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(await screen.findByText(/drag a file here/i)).toBeInTheDocument();
  });
});
