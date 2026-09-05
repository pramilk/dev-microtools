import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { createFakeWorkerClass } from '../../test/fakeWorker';
import { handleBackgroundRemoveRequest } from '../workers/backgroundRemove.worker';
import { handleImageCompressRequest } from '../workers/imageCompress.worker';
import { MODEL_INPUT_SIZE } from '../lib/tools/backgroundRemove';
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
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  drawImage() {}
  fillRect() {}
  strokeRect() {}
  save() {}
  restore() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  arc() {}
  fill() {}
  stroke() {}
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
  createRadialGradient() {
    return { addColorStop: vi.fn() };
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
  // Used by the Template gallery's art-preview effect (`canvas.toDataURL('image/png')`) to
  // build the placement stage's background `<img>` for a procedurally-drawn template.
  vi.spyOn(proto, 'toDataURL').mockReturnValue('data:image/png;base64,fake');

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
    runMock.mockResolvedValue({ output: { data: new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE).fill(0.5) } });
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

    resolveRun({ output: { data: new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE).fill(0.5) } });
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
      expect(document.querySelector('.place-stage__cutout')).toBeInTheDocument();
      expect(document.querySelector('.place-handle--scale')).toBeInTheDocument();
      expect(document.querySelector('.place-handle--rotate')).toBeInTheDocument();
    });

    it('moves the cutout by dragging it, changing the canvas translate call the export uses', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
      chooseBgImage();
      await waitFor(() => expect(document.querySelector('.place-stage')).toBeInTheDocument());
      await waitFor(() => expect(translateSpy).toHaveBeenCalled());
      translateSpy.mockClear();

      const cutout = document.querySelector('.place-stage__cutout')!;
      const stage = document.querySelector('.place-stage')!;
      vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 40, height: 20, right: 40, bottom: 20 } as DOMRect);
      fireEvent.pointerDown(cutout, { clientX: 10, clientY: 5 });
      fireEvent.pointerMove(cutout, { clientX: 20, clientY: 15 });
      fireEvent.pointerUp(cutout);

      await waitFor(() => expect(translateSpy).toHaveBeenCalled());
      const [x, y] = translateSpy.mock.calls[translateSpy.mock.calls.length - 1]!;
      // Started centered at (20, 10) for a 40x20 canvas; dragging by +10/+10 screen px (1:1
      // scale, since the stubbed stage rect matches the canvas's own pixel size) should move
      // the placement by the same amount.
      expect(x).toBeCloseTo(30);
      expect(y).toBeCloseTo(20);
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

    it('flips the cutout horizontally and vertically, negating the canvas scale factors the export uses', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
      chooseBgImage();
      await waitFor(() => expect(document.querySelector('.place-stage')).toBeInTheDocument());
      await waitFor(() => expect(scaleSpy).toHaveBeenCalled());

      const flipX = screen.getByRole('button', { name: /flip horizontal/i });
      const flipY = screen.getByRole('button', { name: /flip vertical/i });
      expect(flipX).toHaveAttribute('aria-pressed', 'false');
      expect(flipY).toHaveAttribute('aria-pressed', 'false');

      scaleSpy.mockClear();
      fireEvent.click(flipX);
      expect(flipX).toHaveAttribute('aria-pressed', 'true');
      await waitFor(() => expect(scaleSpy).toHaveBeenCalled());
      let [sx, sy] = scaleSpy.mock.calls[scaleSpy.mock.calls.length - 1]!;
      expect(sx).toBeLessThan(0);
      expect(sy).toBeGreaterThan(0);

      scaleSpy.mockClear();
      fireEvent.click(flipY);
      expect(flipY).toHaveAttribute('aria-pressed', 'true');
      await waitFor(() => expect(scaleSpy).toHaveBeenCalled());
      [sx, sy] = scaleSpy.mock.calls[scaleSpy.mock.calls.length - 1]!;
      expect(sx).toBeLessThan(0);
      expect(sy).toBeLessThan(0);
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

  describe('blur background', () => {
    it('switches to Blur, defaulting to the Blur style with a strength slider', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /^blur$/i }));

      // Two buttons now match "Blur": the mode-select segment and the Blur/Pixelate style
      // toggle underneath it — both should read as pressed once Blur mode is active.
      const blurButtons = screen.getAllByRole('button', { name: /^blur$/i });
      expect(blurButtons).toHaveLength(2);
      for (const button of blurButtons) expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText(/blur strength/i)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: /download jpeg|download webp|download png/i })).toBeInTheDocument());
    });

    it('switches the strength slider to a block-size control when Pixelate is chosen', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^blur$/i }));

      fireEvent.click(screen.getByRole('button', { name: /^pixelate$/i }));

      expect(screen.getByLabelText(/pixelate block size/i)).toBeInTheDocument();
    });
  });

  describe('background templates', () => {
    it('shows a categorized, scrollable gallery of art and photo templates', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /^template$/i }));

      expect(screen.getByText(/art & patterns/i)).toBeInTheDocument();
      expect(screen.getByText(/nature photos/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /studio/i })).toBeInTheDocument();
    });

    it('lets the cutout be freely placed on a template, same as a replacement image', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /^template$/i }));

      await waitFor(() => expect(document.querySelector('.place-stage')).toBeInTheDocument());
      expect(document.querySelector('.place-handle--scale')).toBeInTheDocument();
      expect(document.querySelector('.place-handle--rotate')).toBeInTheDocument();
    });

    it('repaints the placement stage when a different template is picked', async () => {
      render(<BackgroundRemover />);
      dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^template$/i }));
      await waitFor(() => expect(document.querySelector('.place-stage')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /^beach$/i }));

      await waitFor(() => expect(document.querySelector('.place-stage__bg')).toHaveAttribute('src', '/samples/bg-beach.jpg'));
    });
  });
});
