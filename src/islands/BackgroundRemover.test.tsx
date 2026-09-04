import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { createFakeWorkerClass } from '../../test/fakeWorker';
import { handleBackgroundRemoveRequest } from '../workers/backgroundRemove.worker';
import { handleImageCompressRequest } from '../workers/imageCompress.worker';
import BackgroundRemover from './BackgroundRemover';

// jsdom has no real Worker; these run the real request-handling logic
// (backgroundRemove.worker.ts / imageCompress.worker.ts) synchronously.
vi.mock('../workers/backgroundRemove.worker?worker', () => ({
  default: createFakeWorkerClass(handleBackgroundRemoveRequest),
}));
vi.mock('../workers/imageCompress.worker?worker', () => ({
  default: createFakeWorkerClass(handleImageCompressRequest),
}));

// Real @jsquash/oxipng loads and runs actual WebAssembly, fetching its .wasm asset by URL —
// stood in the same way ImageCropper.test.tsx and ImageCompressor.test.tsx already do.
vi.mock('@jsquash/oxipng', () => ({
  optimise: vi.fn(async (buffer: ArrayBuffer) => buffer),
}));

// Real onnxruntime-web needs actual WebAssembly support this test environment doesn't
// provide, and would also mean downloading a real 4.6 MB model over the network — stood in
// with a fake session, same boundary backgroundRemove.test.ts draws.
const { runMock, createMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  createMock: vi.fn(),
}));
vi.mock('onnxruntime-web/wasm', () => ({
  env: { wasm: {} as Record<string, unknown> },
  InferenceSession: { create: createMock },
  Tensor: vi.fn(function (type: string, data: unknown, dims: number[]) {
    return { type, data, dims };
  }),
}));

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

class FakeImageBitmap {
  width = 40;
  height = 20;
  close() {}
}

const { translateSpy, rotateSpy, scaleSpy, createLinearGradientSpy, addColorStopSpy } = vi.hoisted(() => ({
  translateSpy: vi.fn(),
  rotateSpy: vi.fn(),
  scaleSpy: vi.fn(),
  createLinearGradientSpy: vi.fn(),
  addColorStopSpy: vi.fn(),
}));

class FakeCanvasContext {
  fillStyle = '';
  drawImage() {}
  fillRect() {}
  save() {}
  restore() {}
  translate(x: number, y: number) {
    translateSpy(x, y);
  }
  rotate(angle: number) {
    rotateSpy(angle);
  }
  scale(x: number, y: number) {
    scaleSpy(x, y);
  }
  createLinearGradient(...args: number[]) {
    createLinearGradientSpy(...args);
    return { addColorStop: addColorStopSpy };
  }
  getImageData(_x: number, _y: number, width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4).fill(128), width, height };
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
  // "Load example" fetches a real bundled sample photo rather than generating one — stood in
  // so the test doesn't depend on a real network request or the dev/build server.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob([new Uint8Array(24)], { type: 'image/jpeg' })) })
  );

  const proto = HTMLCanvasElement.prototype;
  vi.spyOn(proto, 'getContext').mockImplementation((() => new FakeCanvasContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(proto, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback) {
    callback(new Blob([new Uint8Array(24)], { type: 'image/png' }));
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

describe('<BackgroundRemover />', () => {
  beforeEach(() => {
    stubCanvasAndDecode();
    runMock.mockReset();
    createMock.mockReset();
    createMock.mockResolvedValue({ inputNames: ['input'], outputNames: ['output'], run: runMock });
    runMock.mockResolvedValue({ output: { data: new Float32Array(320 * 320).fill(0.5) } });
    translateSpy.mockClear();
    rotateSpy.mockClear();
    scaleSpy.mockClear();
    createLinearGradientSpy.mockClear();
    addColorStopSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with a dropzone and no result', () => {
    render(<BackgroundRemover />);
    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  // Runs before any other test in this file so the module-level onnxruntime-web session
  // cache in lib/tools/backgroundRemove.ts (deliberately shared across images in one page
  // visit — see that file's own comment) is still empty; once a later test succeeds, it
  // populates that cache and this mock rejection would never be consulted again. The
  // production retry-after-failure behavior itself (a failed load doesn't get stuck cached)
  // is covered directly in backgroundRemove.test.ts, which resets the module between cases.
  it('shows a visible error when the model fails to load, instead of hanging silently', async () => {
    createMock.mockReset();
    createMock.mockRejectedValue(new Error('network down'));

    render(<BackgroundRemover />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
  });

  it('processes a dropped image and shows a compare slider with a download button, defaulting to transparent PNG output', async () => {
    render(<BackgroundRemover />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByText(/40×20px/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
    expect(screen.getByAltText('Result')).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledTimes(1);
    // Transparent mode never offers JPEG/WebP, since they have no alpha channel to keep.
    expect(screen.queryByRole('button', { name: /^jpeg$/i })).not.toBeInTheDocument();
  });

  it('shows a busy state while background removal is running', async () => {
    let resolveRun: (value: { output: { data: Float32Array } }) => void = () => {};
    runMock.mockReturnValue(new Promise((resolve) => (resolveRun = resolve)));

    render(<BackgroundRemover />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByText(/removing background/i)).toBeInTheDocument();

    resolveRun({ output: { data: new Float32Array(320 * 320).fill(0.5) } });
    await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
  });

  it('shows a visible error for a non-image file instead of silently doing nothing', async () => {
    render(<BackgroundRemover />);
    dropFile(new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't look like an image/i);
  });

  it('loads the bundled sample photo when "Load example" is pressed', async () => {
    render(<BackgroundRemover />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    await screen.findByText(/40×20px/i);
    await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/samples/cat.jpg');
  });

  it('shows a visible error when the sample photo fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    render(<BackgroundRemover />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the sample image/i);
  });

  it('clears the image and returns to the dropzone', async () => {
    render(<BackgroundRemover />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('does not offer a share-link button, since the input is an image file, not text', () => {
    render(<BackgroundRemover />);
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });

  it('switches to a solid-color background, unlocking JPEG/WebP output', async () => {
    render(<BackgroundRemover />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^color$/i }));

    expect(screen.getByLabelText(/^background color$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^jpeg$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^jpeg$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download jpeg/i })).toBeInTheDocument());
  });

  it('reverts to PNG-only output when switching back to a transparent background', async () => {
    render(<BackgroundRemover />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^color$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^jpeg$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download jpeg/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^transparent$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^jpeg$/i })).not.toBeInTheDocument();
  });

  it('switches to a gradient background, painting a two-stop linear gradient and unlocking JPEG/WebP output', async () => {
    render(<BackgroundRemover />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^gradient$/i }));

    expect(screen.getByLabelText(/gradient start color/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/gradient end color/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^jpeg$/i })).toBeInTheDocument();
    await waitFor(() => expect(createLinearGradientSpy).toHaveBeenCalled());
    expect(addColorStopSpy).toHaveBeenCalledTimes(2);
  });

  it('repaints the gradient when a direction preset is picked', async () => {
    render(<BackgroundRemover />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^gradient$/i }));
    await waitFor(() => expect(createLinearGradientSpy).toHaveBeenCalled());

    createLinearGradientSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /left to right/i }));

    await waitFor(() => expect(createLinearGradientSpy).toHaveBeenCalled());
  });

  it('shows a prompt instead of a background until an image mode background is actually chosen', async () => {
    render(<BackgroundRemover />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^image$/i }));

    expect(screen.getByText(/no background image chosen yet/i)).toBeInTheDocument();
  });

  describe('free placement on a replacement background image', () => {
    const chooseBgImage = () => {
      fireEvent.click(screen.getByRole('button', { name: /^image$/i }));
      fireEvent.change(screen.getByLabelText(/choose a replacement background image/i), {
        target: { files: [new File([PNG_SIGNATURE], 'bg.jpg', { type: 'image/jpeg' })] },
      });
    };

    it('shows a draggable placement stage with move/scale/rotate handles once a background is chosen', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());

      chooseBgImage();

      await waitFor(() => expect(document.querySelector('.place-stage')).toBeInTheDocument());
      expect(document.querySelector('.place-handle--scale')).toBeInTheDocument();
      expect(document.querySelector('.place-handle--rotate')).toBeInTheDocument();
      expect(screen.getByLabelText(/cutout horizontal position/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/cutout vertical position/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/cutout scale/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/cutout rotation/i)).toBeInTheDocument();
    });

    it('repositions, rescales and rotates the cutout via the numeric fields', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
      chooseBgImage();
      await waitFor(() => expect(document.querySelector('.place-stage')).toBeInTheDocument());

      fireEvent.input(screen.getByLabelText(/cutout horizontal position/i), { target: { value: '5' } });
      expect((screen.getByLabelText(/cutout horizontal position/i) as HTMLInputElement).value).toBe('5');

      fireEvent.input(screen.getByLabelText(/cutout scale/i), { target: { value: '150' } });
      expect((screen.getByLabelText(/cutout scale/i) as HTMLInputElement).value).toBe('150');

      fireEvent.input(screen.getByLabelText(/cutout rotation/i), { target: { value: '45' } });
      expect((screen.getByLabelText(/cutout rotation/i) as HTMLInputElement).value).toBe('45');
    });

    it('resets placement back to its centered default when "Reset placement" is clicked', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
      chooseBgImage();
      await waitFor(() => expect(document.querySelector('.place-stage')).toBeInTheDocument());

      const originalX = (screen.getByLabelText(/cutout horizontal position/i) as HTMLInputElement).value;
      fireEvent.input(screen.getByLabelText(/cutout horizontal position/i), { target: { value: '999' } });
      expect((screen.getByLabelText(/cutout horizontal position/i) as HTMLInputElement).value).toBe('999');

      fireEvent.click(screen.getByRole('button', { name: /reset placement/i }));

      expect((screen.getByLabelText(/cutout horizontal position/i) as HTMLInputElement).value).toBe(originalX);
    });

    it('applies a canvas translate/rotate/scale transform only once a background image is actually placed', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
      expect(translateSpy).not.toHaveBeenCalled();

      chooseBgImage();

      await waitFor(() => expect(translateSpy).toHaveBeenCalled());
      expect(rotateSpy).toHaveBeenCalled();
      expect(scaleSpy).toHaveBeenCalled();
    });

    it('clears the placement stage and its background image when switching back to Transparent', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
      chooseBgImage();
      await waitFor(() => expect(document.querySelector('.place-stage')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /^transparent$/i }));

      expect(document.querySelector('.place-stage')).not.toBeInTheDocument();
    });
  });
});
