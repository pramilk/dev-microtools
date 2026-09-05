import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { createFakeWorkerClass } from '../../test/fakeWorker';
import { handleImageRedactDetectRequest } from '../workers/imageRedactDetect.worker';
import FacePlateBlur from './FacePlateBlur';

// jsdom has no real Worker; this runs the real request-handling logic
// (imageRedactDetect.worker.ts, which just calls detectFaceRegions) synchronously.
vi.mock('../workers/imageRedactDetect.worker?worker', () => ({
  default: createFakeWorkerClass(handleImageRedactDetectRequest),
}));

// Real onnxruntime-web needs actual WebAssembly support this test environment doesn't
// provide, and would also mean downloading a real model over the network — stood in with a
// fake session, same boundary imageRedact.test.ts draws.
const { runMock, createMock, tensorMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  createMock: vi.fn(),
  tensorMock: vi.fn(function (type: string, data: unknown, dims: number[]) {
    return { type, data, dims };
  }),
}));
vi.mock('onnxruntime-web/wasm', () => ({
  env: { wasm: {} as Record<string, unknown> },
  InferenceSession: { create: createMock },
  Tensor: tensorMock,
}));

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const IMAGE_WIDTH = 40;
const IMAGE_HEIGHT = 20;

class FakeImageBitmap {
  width = IMAGE_WIDTH;
  height = IMAGE_HEIGHT;
  close() {}
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

class FakeCanvasContext {
  drawImage() {}
  putImageData() {}
  getImageData(_x: number, _y: number, width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4).fill(128), width, height };
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

/** One confident face prior, a normalized corner-form box roughly in the middle of the frame. */
const oneFaceDetected = () => ({
  scores: { data: new Float32Array([0, 0.95]), dims: [1, 1, 2] },
  boxes: { data: new Float32Array([0.3, 0.3, 0.7, 0.7]), dims: [1, 1, 4] },
});

const noFacesDetected = () => ({
  scores: { data: new Float32Array([1, 0]), dims: [1, 1, 2] },
  boxes: { data: new Float32Array([0.3, 0.3, 0.7, 0.7]), dims: [1, 1, 4] },
});

describe('<FacePlateBlur />', () => {
  beforeEach(() => {
    stubCanvasAndDecode();
    runMock.mockReset();
    createMock.mockReset();
    createMock.mockResolvedValue({ inputNames: ['input'], run: runMock });
    runMock.mockResolvedValue(oneFaceDetected());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with a dropzone and no result', () => {
    render(<FacePlateBlur />);
    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('shows a visible error for a non-image file instead of silently doing nothing', async () => {
    render(<FacePlateBlur />);
    dropFile(new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't look like an image/i);
  });

  // Runs before any other test that drops a real image, so the module-level
  // onnxruntime-web session cache in lib/tools/imageRedact.ts (deliberately shared across
  // photos in one page visit) is still empty — once a later test succeeds, it populates
  // that cache and this mock rejection would never be consulted again. See
  // BackgroundRemover.test.tsx's identical comment for the same reason.
  it('shows a retryable error when the detection model fails to load, without blocking manual boxes', async () => {
    createMock.mockRejectedValueOnce(new Error('network down'));
    render(<FacePlateBlur />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
    expect(screen.getByRole('button', { name: /add box/i })).not.toBeDisabled();
  });

  it('auto-detects a face on upload and shows it as an adjustable region', async () => {
    render(<FacePlateBlur />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByTitle(/automatically detected face/i)).toBeInTheDocument();
    expect(screen.getByText(/1 region marked/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument());
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('shows a "no regions" hint and still lets manual boxes be added when nothing is detected', async () => {
    runMock.mockResolvedValue(noFacesDetected());
    render(<FacePlateBlur />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(screen.getByText(/no regions marked yet/i)).toBeInTheDocument());
    expect(screen.queryByTitle(/automatically detected face/i)).not.toBeInTheDocument();
  });

  it('adds a manual region via "Add box" and removes it again via its delete button', async () => {
    runMock.mockResolvedValue(noFacesDetected());
    render(<FacePlateBlur />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByText(/no regions marked yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add box/i }));
    expect(await screen.findByTitle(/manually added region/i)).toBeInTheDocument();
    expect(screen.getByText(/1 region marked/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    await waitFor(() => expect(screen.getByText(/no regions marked yet/i)).toBeInTheDocument());
  });

  it('lets each region keep its own independent redaction style', async () => {
    runMock.mockResolvedValue(noFacesDetected());
    render(<FacePlateBlur />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByText(/no regions marked yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add box/i }));
    fireEvent.click(screen.getByRole('button', { name: /add box/i }));
    await waitFor(() => expect(screen.getByText(/2 regions marked/i)).toBeInTheDocument());

    const pixelateButtons = screen.getAllByRole('button', { name: /^pixelate$/i });
    expect(pixelateButtons).toHaveLength(2);

    // Switch only the first region to Pixelate — the second must stay on Blur.
    fireEvent.click(pixelateButtons[0]!);
    const blurButtons = screen.getAllByRole('button', { name: /^blur$/i });
    expect(pixelateButtons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(blurButtons[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('defaults an auto-detected face to an oval mask and a manual box to a rectangle', async () => {
    runMock.mockResolvedValue(oneFaceDetected());
    render(<FacePlateBlur />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByTitle(/automatically detected face/i);

    expect(screen.getByRole('button', { name: /^oval$/i })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /add box/i }));
    await waitFor(() => expect(screen.getByText(/2 regions marked/i)).toBeInTheDocument());
    const rectangleButtons = screen.getAllByRole('button', { name: /^rectangle$/i });
    // Region 1 (the detected face) stays on Oval; region 2 (the manual box) defaults to Rectangle.
    expect(rectangleButtons[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches redaction style and re-renders the output', async () => {
    render(<FacePlateBlur />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^pixelate$/i }));
    expect(screen.getByRole('button', { name: /^pixelate$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/pixelate block size/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^solid box$/i }));
    // Solid box has no intensity to tune.
    expect(screen.queryByLabelText(/pixelate block size/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/blur strength/i)).not.toBeInTheDocument();
  });

  it('loads the bundled sample photo when "Load example" is pressed', async () => {
    render(<FacePlateBlur />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/samples/face-sample.jpg');
  });

  it('clears the image and returns to the dropzone', async () => {
    render(<FacePlateBlur />);
    dropFile(new File([PNG_SIGNATURE], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('does not offer a share-link button, since the input is an image file, not text', () => {
    render(<FacePlateBlur />);
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });
});
